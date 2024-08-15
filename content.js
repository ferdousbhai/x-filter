const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';
const DELAY = 500;

const getSettings = async () => {
    const { topics = [], GROQ_API_KEY = '' } = await chrome.storage.sync.get(['topics', 'GROQ_API_KEY']);
    return { topics, GROQ_API_KEY };
};

const getCachedAnalyses = async (postIds) => {
    const results = await chrome.storage.local.get(postIds);
    return postIds.map(id => results[id] || null);
};

const truncateText = (text, maxLength = 280) => 
    text.length <= maxLength ? text : text.slice(0, maxLength - 3) + '...';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const checkForNewPosts = async () => {
    console.log("Checking for new posts");
    const { topics, GROQ_API_KEY } = await getSettings();
    if (!GROQ_API_KEY || topics.length === 0) {
        console.error("Missing API key or topics. Aborting analysis.");
        return;
    }

    const posts = document.querySelectorAll('[data-testid="cellInnerDiv"]:not([data-analyzed])');
    const tweetsToAnalyze = [];
    const postIds = [];

    posts.forEach(post => {
        const tweetArticle = post.querySelector('article[data-testid="tweet"]');
        if (!tweetArticle) return;

        const postId = tweetArticle.querySelector('a[href*="/status/"]')?.href.split('/status/')[1];
        if (!postId) return;

        postIds.push(postId);
        const postText = tweetArticle.querySelector('[data-testid="tweetText"]')?.innerText.trim() || '';
        tweetsToAnalyze.push({ id: postId, text: truncateText(postText) });
        post.dataset.analyzed = 'true';
    });

    const cachedAnalyses = await getCachedAnalyses(postIds);
    const uncachedTweets = tweetsToAnalyze.filter((_, index) => !cachedAnalyses[index]);

    cachedAnalyses.forEach((analysis, index) => {
        if (analysis) {
            hidePostIfMatchesTopics(postIds[index], analysis, topics);
        }
    });

    if (uncachedTweets.length > 0) {
        const batchAnalysis = await analyzeTweets(uncachedTweets);
        const analysesToCache = Object.fromEntries(
            batchAnalysis.map(result => [result.tweetId, result.analysis])
        );
        await chrome.storage.local.set(analysesToCache);
        batchAnalysis.forEach(result => {
            hidePostIfMatchesTopics(result.tweetId, result.analysis, topics);
        });
    }
};

const hidePostIfMatchesTopics = (postId, analysis, topics) => {
    if (!analysis || typeof analysis !== 'object') return;
    const matchingTopics = topics.filter(topic => analysis[topic]);
    if (matchingTopics.length === 0) return;

    const postElement = document.querySelector(`[data-testid="cellInnerDiv"] a[href*="/status/${postId}"]`)?.closest('[data-testid="cellInnerDiv"]');
    if (!postElement || postElement.style.display === 'none') return;

    postElement.style.display = 'none';
    const tweetText = postElement?.querySelector('[data-testid="tweetText"]')?.innerText?.trim() ?? '';
    console.log(`Post ${postId} hidden due to ${matchingTopics.join(', ')}\n${truncateText(tweetText, 128)}`);
};

const analyzeTweets = async (tweets) => {
    console.log(`Analyzing ${tweets.length} tweets`);
    const { topics, GROQ_API_KEY } = await getSettings();
    const messages = [
        {
            role: "system",
            content: `Classify a batch of Tweets. Respond with a JSON object: 
            {
                "results": [
                    {
                        "tweetId": "...",
                        "analysis": {
                            "topic1": boolean,
                            "topic2": boolean,
                            ...
                        }
                    },
                    ...
                ]
            }`
        },
        {
            role: "user",
            content: `Analyze tweets for topics: ${topics.join(', ')}\n${JSON.stringify(tweets)}`
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
                    messages,
                    model: MODEL_NAME,
                    temperature: 0.1,
                    max_tokens: 4096,
                    top_p: 1,
                    stream: false,
                    response_format: { type: "json_object" },
                })
            });
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
            }
            const { choices } = await response.json();
            return JSON.parse(choices[0]?.message?.content).results;
        } catch (error) {
            console.error(`Error analyzing tweets (attempt ${retries + 1}/3):`, error);
            if (retries === 2) return [];
            await delay(DELAY);
        }
    }
    return [];
};

const debounce = (func, delay) => {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
};

const debouncedCheck = debounce(checkForNewPosts, DELAY);

if (window.location.hostname === 'x.com') {
    const observer = new MutationObserver(debouncedCheck);
    observer.observe(document.body, { childList: true, subtree: true });
    checkForNewPosts();
}