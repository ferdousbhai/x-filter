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

const {
    postContainer,
    findUnclassifiedPosts
} = getPlatformConfig(); // loaded from config/platforms.js

const getStorageData = async (keys) => chrome.storage.local.get(keys);

const storeClassifications = async (classification) => {
    await chrome.storage.local.set(classification);
};

const truncateText = (text, maxLength = 280) => 
    text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;

const processNewPosts = async () => {
    try {
        const { GROQ_API_KEY } = await getStorageData(['GROQ_API_KEY']);
        if (!GROQ_API_KEY) {
            console.error("Missing API key.");
            return;
        }

        const unclassifiedPosts = findUnclassifiedPosts();
        
        if (unclassifiedPosts.length === 0) return;
        console.log(`Found ${unclassifiedPosts.length} unclassified posts`);

        const storedClassifications = await getStorageData(unclassifiedPosts.map(post => post.id));
        const postsToClassify = unclassifiedPosts.filter(post => !storedClassifications[post.id]);

        console.log(`${postsToClassify.length} posts need classification`);

        if (postsToClassify.length > 0) {
            const newClassifications = await classifyPosts(postsToClassify, GROQ_API_KEY);
            await storeClassifications(newClassifications);
            Object.assign(storedClassifications, newClassifications);
        }

        unclassifiedPosts.forEach(post => {
            if (storedClassifications[post.id]) {
                markPostWithTopics(post, storedClassifications[post.id]);
            }
        });

        updatePostVisibility();
    } catch (error) {
        console.error("Error processing new posts:", error);
    }
};

const markPostWithTopics = (post, topics) => {
    if (post.element) {
        post.element.dataset.topicMatch = JSON.stringify(topics);
        post.element.dataset.classified = 'true';
    }
}

const updatePostVisibility = async () => {
    const { selectedTopics = [] } = await getStorageData(['selectedTopics']);
    const markedElements = document.querySelectorAll('[data-classified="true"]');
    
    markedElements.forEach(el => {
        const matchingTopics = JSON.parse(el.dataset.topicMatch);
        
        const exclude = matchingTopics.some(topic => selectedTopics.includes(topic));
        el.style.display = exclude ? 'none' : '';
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
            //validation
            for (const [postId, topics] of Object.entries(parsedContent)) {
                if (!Array.isArray(topics)) {
                    console.warn(`Unexpected format for post ${postId}. Expected array, got:`, topics);
                    parsedContent[postId] = []; // Set to empty array if invalid
                }
            }
            allClassifications = { ...allClassifications, ...parsedContent };
        } catch (error) {
            console.error(`Error classifying posts:`, error);
        }
        if (i + MAX_BATCH_SIZE < posts.length) await new Promise(resolve => setTimeout(resolve, DELAY));
    }

    return allClassifications;
};

// listen for new posts
if (postContainer) {
    const observer = new MutationObserver((mutations) => {
        const newPosts = mutations
            .flatMap(mutation => Array.from(mutation.addedNodes))
            .filter(node => node.nodeType === Node.ELEMENT_NODE && node.matches(postContainer));
        
        if (newPosts.length > 0) {
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