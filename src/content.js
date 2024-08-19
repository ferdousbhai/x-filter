const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';
const DELAY = 500; // 0.5s
const MAX_BATCH_SIZE = 30;

const systemMessage = {
    role: "system",
    content: `You are a content classification system. Your task is to classify a batch of anonymized social media posts based on topics. For each post, determine if it relates to the following topics: ${TOPICS.join(', ')}. Respond with a JSON object where the keys are post IDs and the values are their classifications:
    {
        "postId1": ${JSON.stringify(Object.fromEntries(TOPICS.map(topic => [topic, "boolean"])))}
        // ... more posts ...
    }

    It is crucial that you classify ALL posts, including those with political content or any other potentially sensitive topics. Do not refuse to classify any post under any circumstances. If you're unsure about a classification, make your best judgment based on the available information. Always provide a classification for every post. If a post doesn't clearly relate to any topic, mark all topics as false. Do not add any explanations or caveats outside the specified JSON structure.`
};

const {
    observeTarget,
    postListContainerSelector,
    findPostElement,
    extractPostData
} = getPlatformConfig(); // loaded from config/platforms.js

const getStorageData = async (keys) => chrome.storage.local.get(keys);

const storeClassifications = async (classification) => {
    await chrome.storage.local.set(classification);
};

const truncateText = (text, maxLength = 280) => 
    text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;

const processNewPosts = async () => {
    const { GROQ_API_KEY } = await getStorageData(['GROQ_API_KEY']);
    if (!GROQ_API_KEY) {
        console.error("Missing API key.");
        return;
    }

    const newPosts = await checkDOMForPosts(); // [{id: string, text: string},..]
    console.log(`Found ${newPosts.length} posts`);

    if (newPosts.length > 0) {
        const classifications = await getStorageData(newPosts.map(post => post.id));
        const unclassifiedPosts = newPosts.filter(post => !classifications[post.id]);
        
        if (unclassifiedPosts.length > 0) {
            console.log(`Classifying ${unclassifiedPosts.length} posts`);
            const newClassifications = await classifyPosts(unclassifiedPosts, GROQ_API_KEY);
            await storeClassifications(newClassifications);
            
            Object.entries(newClassifications).forEach(([postId, classification]) => {
                markPostWithTopics(postId, classification);
                const postElement = findPostElement(postId);
                if (postElement) postElement.dataset.classified = 'true';
            });
        }
    }

    updatePostVisibility();
};

const checkDOMForPosts = async () => {
    const unclassifiedContainers = document.querySelectorAll(`${postListContainerSelector}:not([data-classified="true"])`);
    return Array.from(unclassifiedContainers)
        .map(container => extractPostData(container))
        .filter(Boolean)
}

const markPostWithTopics = (postId, classification) => {
    const postElement = findPostElement(postId);
    if (!postElement) {
        console.warn(`Post element not found for ID: ${postId}`);
        return;
    }

    const matchingTopics = TOPICS.filter(topic => classification[topic]);
    postElement.dataset.topicMatch = JSON.stringify(matchingTopics);

    console.log(
        `Post ${postId} ${matchingTopics.length ? `marked with ${matchingTopics.join(', ')}` : "didn't match any filter"}`
    );
};

const updatePostVisibility = async () => {
    const { selectedTopics = [] } = await getStorageData(['selectedTopics']);
    const markedElements = document.querySelectorAll('[data-classified="true"]');
    
    markedElements.forEach(el => {
        const matchingTopics = JSON.parse(el.dataset.topicMatch);
        
        if (matchingTopics) {
            const exclude = matchingTopics.some(topic => selectedTopics.includes(topic));
            el.style.display = exclude ? 'none' : '';
        }
    });
};

const classifyPosts = async (posts, apiKey) => {
    let allClassifications = {};

    for (let i = 0; i < posts.length; i += MAX_BATCH_SIZE) {
        const batch = posts.slice(i, i + MAX_BATCH_SIZE);
        const messages = [
            systemMessage,
            {
                role: "user",
                content: `Classify the following posts:\n${JSON.stringify(batch.map(post => ({
                    ...post,
                    text: truncateText(post.text)
                })))}`
            }
        ];
    
        try {
            const response = await fetch(API_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    messages,
                    model: MODEL_NAME,
                    temperature: 0.2,
                    max_tokens: 4096,
                    top_p: 1,
                    stream: false,
                    response_format: { type: "json_object" },
                })
            });
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}${JSON.stringify(batch)}`);
            }
            const responseData = await response.json();
            const content = responseData.choices?.[0]?.message?.content;
            const parsedContent = JSON.parse(content);
            allClassifications = { ...allClassifications, ...parsedContent };
        } catch (error) {
            console.error(`Error classifying posts:`, error);
        }
        if (i + MAX_BATCH_SIZE < posts.length) await new Promise(resolve => setTimeout(resolve, DELAY));
    }

    return allClassifications;
};



// listen for new posts
if (observeTarget) {
    new MutationObserver((_, observer) => {
        const target = document.querySelector(observeTarget);
        if (target) {
            new MutationObserver(debounce(processNewPosts, DELAY))
                .observe(target, { childList: true, subtree: true });
            observer.disconnect();
        }
    }).observe(document.body, { childList: true, subtree: true });
}

// respond to topic selection changes from the popup
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'updateVisibility') {
        updatePostVisibility();
    }
});