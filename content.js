// Constants
const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';

// Helper functions
const getStorageData = () => chrome.storage.sync.get(['topics', 'GROQ_API_KEY']);
const getCachedAnalysis = postId => chrome.storage.local.get(postId).then(result => result[postId] ?? null);
const cacheAnalysis = (postId, analysis) => chrome.storage.local.set({ [postId]: analysis });
const resetCache = async () => {
    await chrome.storage.local.clear();
    console.log('Cache (analysis results) has been reset.');
};
const truncateTweet = (text, maxLength = 280) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
};

// Main function
const checkForNewPosts = async () => {
    const { topics = [], GROQ_API_KEY } = await getStorageData();
    if (!GROQ_API_KEY || topics.length === 0) {
        console.error("Missing API key or topics. Aborting analysis.");
        console.log('API Key:', GROQ_API_KEY ? 'Present' : 'Missing');
        console.log('Topics:', topics);
        return;
    }

    const posts = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    const newPosts = Array.from(posts).filter(post => !post.dataset.analyzed);
    const tweetsToAnalyze = [];

    for (const post of newPosts) {
        const tweetArticle = post.querySelector('article[data-testid="tweet"]');
        if (!tweetArticle) continue;

        const postId = tweetArticle.querySelector('a[href*="/status/"]')?.href.split('/status/')[1];
        const postText = tweetArticle.querySelector('[data-testid="tweetText"]')?.innerText.trim() ?? '';
        if (!postId) continue;

        const cachedAnalysis = await getCachedAnalysis(postId);
        if (cachedAnalysis) {
            applyPostVisibility(postId, cachedAnalysis, topics);
        } else {
            tweetsToAnalyze.push({ id: postId, text: truncateTweet(postText) });
        }
        post.dataset.analyzed = true;
    }

    if (tweetsToAnalyze.length > 0) {
        const batchAnalysis = await analyzeTweets(tweetsToAnalyze);
        for (const result of batchAnalysis) {
            await cacheAnalysis(result.tweetId, result.analysis);
            applyPostVisibility(result.tweetId, result.analysis, topics);
        }
    }
};


// Function to apply post visibility based on analysis
const applyPostVisibility = (postId, analysis, topics) => {
    if (!analysis || typeof analysis !== 'object') return;
    const matchingTopics = topics.filter(topic => analysis[topic]);
    if (matchingTopics.length === 0) return;

    const postElement = document.querySelector(`[data-testid="cellInnerDiv"] a[href*="/status/${postId}"]`)?.closest('[data-testid="cellInnerDiv"]');
    if (!postElement || postElement.style.display === 'none') return;

    postElement.style.display = 'none';
    console.log(`Post ${postId} hidden due to ${matchingTopics.join(', ')}\n${postElement.querySelector('[data-testid="tweetText"]')?.innerText.trim() ?? 'Text not found'}`);
};

const analyzeTweets = async (tweets) => {
    const { topics, GROQ_API_KEY } = await getStorageData();
    if (!GROQ_API_KEY) return console.error('GROQ API key is missing. Please set it in the extension options.');
    
    console.log(`Analyzing ${tweets.length} tweets`);

    const messages = [
        {
            role: "system",
            content: "Your task is to classify a batch of Tweets. Respond with a JSON object containing a single key 'results' whose value is an array. For each tweet in this array, provide an object with 'tweetId' and 'analysis' properties. The 'analysis' should be an object with the given topics as keys and boolean values."
        },
        {
            role: "user",
            content: `Analyze the following tweets for these topics: ${topics.join(', ')}\n${JSON.stringify(tweets, null, 2)}`
        }
    ];

    for (let retries = 0; retries < 3; retries++) {
        try {
            const response = await fetch(API_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    messages: messages,
                    model: MODEL_NAME,
                    temperature: 0.2,
                    max_tokens: 4096,
                    top_p: 1,
                    stream: false,
                    response_format: { type: "json_object" },
                    stop: null
                })
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const responseData = await response.json();
            const content = responseData.choices[0].message.content;
            // console.log(`response: ${content}`);
            return JSON.parse(content).results;
        } catch (error) {
            console.error(`Error analyzing tweets (attempt ${retries + 1}/3):`, error);
            if (retries === 2) return [];
        }
    }
    return [];
};

// Debounce function to limit how often the scroll event fires
const debounce = (func, delay) => {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

// Event listeners
const debouncedCheck = (() => {
    let timeoutId;
    return () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(checkForNewPosts, 500);
    };
})();

if (window.location.hostname === 'x.com') {
    window.addEventListener('scroll', debouncedCheck);
    checkForNewPosts();
}