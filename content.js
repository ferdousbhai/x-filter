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
    for (const post of Array.from(posts).filter(post => !post.dataset.analyzed)) {
        const tweetArticle = post.querySelector('article[data-testid="tweet"]');
        if (!tweetArticle) continue;

        const postId = tweetArticle.querySelector('a[href*="/status/"]')?.href.split('/status/')[1];
        const postText = tweetArticle.querySelector('[data-testid="tweetText"]')?.innerText.trim() ?? '';
        if (!postId) continue;

        const analysis = await getCachedAnalysis(postId) || await analyzeTweet(postText);
        if (analysis) {
            await cacheAnalysis(postId, analysis);
            applyPostVisibility(postId, analysis, topics);
        }
        post.dataset.analyzed = true;
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
    console.log(`Post ${postId} hidden due to matching topics: ${matchingTopics}\nTweet URL: https://x.com/user/status/${postId}\nTweet Text: ${postElement.querySelector('[data-testid="tweetText"]')?.innerText.trim() ?? 'Text not found'}`);
};

const analyzeTweet = async (tweetText) => {
    const { topics, GROQ_API_KEY } = await getStorageData();
    if (!GROQ_API_KEY) return console.error('GROQ API key is missing. Please set it in the extension options.');

    const messages = [
        { role: "system", content: `Your task is to classify Tweets/X posts. Always respond in JSON. Follow this format:\n\n{\n${topics.map(topic => `    "${topic}": false`).join(',\n')}\n}\n\nSet the value to true if the tweet belongs to that topic, false otherwise.` },
        { role: "user", content: tweetText }
    ];

    for (let retries = 0; retries < 3; retries++) {
        try {
            const response = await fetch(API_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
                body: JSON.stringify({ messages, model: MODEL_NAME, temperature: 0.2, max_tokens: 1024, top_p: 1, stream: false, response_format: { type: "json_object" }, stop: null })
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return JSON.parse((await response.json()).choices[0].message.content);
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

// Uncomment for debug mode
// Object.assign(window, { resetCache, analyzeTweet, checkForNewPosts, getStorageData, getCachedAnalysis, cacheAnalysis, applyPostVisibility });
// console.log('Debug mode active. Functions exposed to window object.');