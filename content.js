// Constants
const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';

// Helper functions
const getStorageData = async () => chrome.storage.sync.get(['topics', 'GROQ_API_KEY']);

const getCachedAnalysis = postId => chrome.storage.local.get(postId)
    .then(result => result[postId] ?? null);

const cacheAnalysis = (postId, analysis) => chrome.storage.local.set({ [postId]: analysis });

const resetCache = async () => {
    const items = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(items));
    console.log('Cache (analysis results) has been reset.');
};


// Main function
const checkForNewPosts = async () => {
    const { topics = [], GROQ_API_KEY } = await getStorageData();
    if (!GROQ_API_KEY || topics.length === 0) {
        console.error("Missing API key or topics. Aborting analysis.");
        return;
    }

    const posts = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    const newPosts = Array.from(posts).filter(post => !post.dataset.analyzed);
    await Promise.all(newPosts.map(async post => {
        const tweetArticle = post.querySelector('article[data-testid="tweet"]');
        if (!tweetArticle) return;

        const postId = tweetArticle.querySelector('a[href*="/status/"]')?.href.split('/status/')[1];
        const postText = tweetArticle.querySelector('[data-testid="tweetText"]')?.innerText.trim() ?? '';

        if (!postId) return;

        const cachedAnalysis = await getCachedAnalysis(postId);
        if (cachedAnalysis) {
            applyPostVisibility(postId, cachedAnalysis, topics);
            return;
        }

        const analysis = await analyzeTweet(postText);
        if (analysis) {
            await cacheAnalysis(postId, analysis);
            applyPostVisibility(postId, analysis, topics);
        }
        post.dataset.analyzed = true;
    }));
};


// Function to apply post visibility based on analysis
const applyPostVisibility = (postId, analysis, topics) => {
    if (!analysis || typeof analysis !== 'object') return;

    const matchingTopics = topics.filter(topic => analysis[topic]);
    if (matchingTopics.length === 0) return;

    const postElement = findPostElement(postId);
    if (!postElement || postElement.style.display === 'none') return;

    postElement.style.display = 'none';

    const tweetUrl = `https://x.com/user/status/${postId}`;
    const tweetText = postElement.querySelector('[data-testid="tweetText"]')?.innerText.trim() ?? 'Text not found';
    
    console.log(`Post ${postId} hidden due to matching topics: ${matchingTopics}\nTweet URL: ${tweetUrl}\nTweet Text: ${tweetText}`);
};

// Function to find the div element containing a specific post ID
const findPostElement = postId => {
    const cellInnerDivs = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    return Array.from(cellInnerDivs).find(div => div.querySelector(`a[href*="/status/${postId}"]`)) || null;
};

const analyzeTweet = async (tweetText) => {
    const { topics, GROQ_API_KEY } = await getStorageData();
    if (!GROQ_API_KEY) {
        console.error('GROQ API key is missing. Please set it in the extension options.');
        return {};
    }

    const messages = [
        {
            role: "system",
            content: `Your task is to classify Tweets/X posts. Always respond in JSON. Follow this format:\n\n{\n${topics.map(topic => `    "${topic}": false`).join(',\n')}\n}\n\nSet the value to true if the tweet belongs to that topic, false otherwise.`
        },
        { role: "user", content: tweetText }
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
                    messages,
                    model: MODEL_NAME,
                    temperature: 0.2,
                    max_tokens: 1024,
                    top_p: 1,
                    stream: false,
                    response_format: { type: "json_object" },
                    stop: null
                })
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            const result = JSON.parse(data.choices[0].message.content);
            return result;
        } catch (error) {
            console.error(`Error analyzing tweet (attempt ${retries + 1}/3):`, error);
            if (retries === 2) return {};
        }
    }
    return {};
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
const debouncedCheck = debounce(checkForNewPosts, 300);

if (window.location.hostname === 'x.com') {
    window.addEventListener('scroll', debouncedCheck);
    checkForNewPosts();
}

// Debug mode
const DEBUG_MODE = true;
if (DEBUG_MODE) {
    Object.assign(window, {
        findPostElement, resetCache, analyzeTweet, checkForNewPosts, getStorageData,
        getCachedAnalysis, cacheAnalysis, applyPostVisibility
    });
    console.log('Debug mode active. Functions exposed to window object.');
}