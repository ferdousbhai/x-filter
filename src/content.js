const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';
const DELAY = 500; // 0.5s
const MAX_BATCH_SIZE = 30;

const systemMessage = {
    role: "system",
    content: `You are a content classification system. Your task is to classify a batch of anonymized social media posts based on topics. For each post, determine if it relates to the following topics: ${TOPICS.join(', ')}. Respond with a JSON object where the keys are post IDs and the values are arrays of matching topics:
    {
        "postId1": ["topic1", "topic3"],
        "postId2": [],
        // ... more posts ...
    }

    It is crucial that you classify ALL posts, including those with political content or any other potentially sensitive topics. Do not refuse to classify any post under any circumstances. If you're unsure about a classification, make your best judgment based on the available information. Always provide a classification for every post. If a post doesn't clearly relate to any topic, return an empty array. Do not add any explanations or caveats outside the specified JSON structure.`
};

const { postContainer, getPostElement, getPostId, getPostText } = getPlatformConfig(); // from config/platforms.js

const getStorageData = async (keys) => chrome.storage.local.get(keys);

const storeClassifications = async (classification) => {
    await chrome.storage.local.set(classification);
};

const truncateText = (text, maxLength = 280) => 
    text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;

const findUnclassifiedPosts = async (config) => {
    const unclassifiedPosts = [];
    const containers = document.querySelectorAll(`${config.postContainer}:not([data-classified="true"])`);
    
    const existingClassifications = await getStorageData(null);
    
    for (const container of containers) {
        const postElement = config.getPostElement(container);
        if (!postElement) continue;
    
        const postId = config.getPostId(postElement);
        if (!postId) continue;
    
        if (existingClassifications[postId] !== undefined) {
            markPostWithTopics({ element: container }, existingClassifications[postId]);
            continue;
        }
    
        const postText = config.getPostText(postElement);
        unclassifiedPosts.push({ id: postId, text: postText, element: container });
    }
    
    return unclassifiedPosts;
};


const processNewPosts = async () => {
    try {
        const { GROQ_API_KEY } = await getStorageData(['GROQ_API_KEY']);
        if (!GROQ_API_KEY) {
            console.error("Missing API key.");
            return;
        }

        const unclassifiedPosts = await findUnclassifiedPosts({ postContainer, getPostElement, getPostId, getPostText });
        if (unclassifiedPosts.length === 0) return;
        console.log(`Found ${unclassifiedPosts.length} unclassified posts`);

        const newClassifications = await classifyPosts(unclassifiedPosts, GROQ_API_KEY);
        await storeClassifications(newClassifications);

        unclassifiedPosts.forEach(post => {
            const topics = newClassifications[post.id];
            if (topics !== undefined) {
                markPostWithTopics(post, topics);
            }
        });

        updatePostVisibility();
    } catch (error) {
        console.error("Error processing new posts:", error);
    }
};



const markPostWithTopics = (post, topics) => {
    if (post.element) {
        Object.assign(post.element.dataset, {
            topicMatch: JSON.stringify(topics),
            classified: 'true'
        });
    }
}

const updatePostVisibility = async () => {
    const { selectedTopics = [] } = await getStorageData(['selectedTopics']);
    document.querySelectorAll('[data-classified="true"]').forEach(el => {
        const matchingTopics = JSON.parse(el.dataset.topicMatch);
        el.style.display = matchingTopics.some(topic => selectedTopics.includes(topic)) ? 'none' : '';
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
                throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}${JSON.stringify(batch)}`); //important for debugging
            }
            const { choices } = await response.json();
            const parsedContent = JSON.parse(choices[0].message.content);
            
            Object.entries(parsedContent).forEach(([postId, topics]) => {
                allClassifications[postId] = Array.isArray(topics) ? topics : [];
            });
        } catch (error) {
            console.error(`Error classifying posts:`, error);
        }
        if (i + MAX_BATCH_SIZE < posts.length) await new Promise(resolve => setTimeout(resolve, DELAY));
    }
    
    console.log(`Classified ${Object.keys(allClassifications).length} posts`);
    Object.entries(allClassifications).forEach(([postId, topics]) => {
        console.log(`Post ${postId}: ${topics.join(', ')}\n${truncateText(posts.find(post => post.id === postId).text, 128)}`);
    });
    return allClassifications;
};

// listen for new posts
if (postContainer) {
    const processedPosts = new Set();
    const observer = new MutationObserver((mutations) => {
        const newPosts = mutations
            .flatMap(mutation => Array.from(mutation.addedNodes))
            .filter(node => node.nodeType === Node.ELEMENT_NODE && node.matches(postContainer))
            .filter(node => !processedPosts.has(node));
        
        if (newPosts.length > 0) {
            newPosts.forEach(post => processedPosts.add(post));
            debounce(processNewPosts, DELAY)();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// respond to topic selection changes from the popup
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'updateVisibility') {
        updatePostVisibility();
    }
});