const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';
const DELAY = 500; // 0.5s
const MAX_BATCH_SIZE = 30;

const systemMessage = {
    role: "system",
    content: `You are a precise content classification system. Your task is to classify a batch of anonymized social media posts based on specific topics. For each post, determine if it relates to the following topics: ${TOPICS.join(', ')}. Respond with a JSON object where the keys are post IDs and the values are arrays of matching topics:
    {
        "postId1": ["topic1", "topic3"],
        "postId2": [],
        // ... more posts ...
    }

    Follow these guidelines strictly:
    1. Only classify posts as relating to a topic if there's a clear and direct connection.
    2. Avoid overgeneralization or stretching interpretations to fit a topic.
    3. If a post doesn't clearly relate to any topic, return an empty array.
    4. Be consistent in your classifications across similar posts.
    5. Consider the context and nuance of each post.
    6. Do not add topics based on implied or assumed information not present in the text.

    It is crucial that you classify ALL posts, including those with political content or any other potentially sensitive topics. Do not refuse to classify any post under any circumstances. If you're unsure about a classification, err on the side of caution and do not assign a topic. Always provide a classification for every post. Do not add any explanations or caveats outside the specified JSON structure.`
}; // TOPICS is defined in config/topics.js

const config = getPlatformConfig(); // getPlatformConfig is defined in config/platforms.js

const getStorageData = async (keys) => chrome.storage.local.get(keys);

const storeClassifications = async (classification) => {
    await chrome.storage.local.set(classification);
};

const truncateText = (text, maxLength = 280) => 
    text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;

const findUnclassifiedPosts = async (config) => {
    const containers = [...document.querySelectorAll(`${config.postContainer}:not([data-classified="true"])`)];
    const existingClassifications = await getStorageData(null);
    
    return containers.reduce((acc, container) => {
        const postElement = config.getPostElement(container);
        const postId = postElement && config.getPostId(postElement);
        
        if (!postId) return acc;
        
        if (existingClassifications[postId] !== undefined) {
            markPostWithTopics(container, existingClassifications[postId]);
            return acc;
        }
        
        acc.unclassifiedPosts.push({ id: postId, text: config.getPostText(postElement) });
        acc.containers.push(container);
        return acc;
    }, { unclassifiedPosts: [], containers: [] });
};

const processNewPosts = async () => {
    try {
        const { GROQ_API_KEY } = await getStorageData(['GROQ_API_KEY']);
        if (!GROQ_API_KEY) throw new Error("Missing API key.");

        const { unclassifiedPosts, containers } = await findUnclassifiedPosts(config);
        if (unclassifiedPosts.length === 0) return;

        console.log(`Found ${unclassifiedPosts.length} unclassified posts`);
        const newClassifications = await classifyPosts(unclassifiedPosts, GROQ_API_KEY);
        await storeClassifications(newClassifications);

        containers.forEach(container => {
            const postId = config.getPostId(config.getPostElement(container));
            const topics = postId && newClassifications[postId];
            if (topics) markPostWithTopics(container, topics);
        });

        updatePostVisibility();
    } catch (error) {
        console.error("Error processing new posts:", error);
    }
};

const markPostWithTopics = (container, topics) => {
    Object.assign(container.dataset, {
        topicMatch: JSON.stringify(topics),
        classified: 'true'
    });
}

const updatePostVisibility = async () => {
    const { selectedTopics = [] } = await getStorageData(['selectedTopics']);
    document.querySelectorAll('[data-classified="true"]').forEach(el => {
        const matchingTopics = JSON.parse(el.dataset.topicMatch);
        el.style.display = matchingTopics.some(topic => selectedTopics.includes(topic)) ? 'none' : '';
    });
};

const classifyPosts = async (posts, apiKey) => {
    let classifications = {};

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
                    temperature: 0.1,
                    max_tokens: 4096,
                    top_p: 1,
                    stream: false,
                    response_format: { type: "json_object" },
                })
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}, body: ${await response.text()}${JSON.stringify(batch)}`);
            }
            const { choices } = await response.json();
            const parsedContent = JSON.parse(choices[0].message.content);
            
            Object.entries(parsedContent).forEach(([postId, topics]) => {
                classifications[postId] = Array.isArray(topics) ? topics : [];
            });
        } catch (error) {
            console.error(`Error classifying posts:`, error);
        }
        if (i + MAX_BATCH_SIZE < posts.length) await new Promise(resolve => setTimeout(resolve, DELAY));
    }
    
    console.log(`Classified ${Object.keys(classifications).length} posts`);
    Object.entries(classifications).forEach(([postId, topics]) => {
        console.log(`Post ${postId}: ${topics.join(', ')}\n${truncateText(posts.find(post => post.id === postId).text, 128)}`);
    });
    return classifications;
};

// Initialize the observer
config?.observeNewPosts?.(() => debounce(processNewPosts, DELAY)());


// respond to topic selection changes from the popup
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'updateVisibility') {
        updatePostVisibility();
    }
});