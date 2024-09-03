const config = getPlatformConfig();
let lastKnownTopics = [], classificationCache = {};

const getStorageData = async (keys) => chrome.storage.local.get(keys);
const setStorageData = async (data) => chrome.storage.local.set(data);

const findUnclassifiedPosts = async (config, forceReclassify = false) => {
    const containers = [...document.querySelectorAll(`${config.postContainer}:not([data-classified="true"])`)];
    if (forceReclassify) containers.forEach(c => { delete c.dataset.classified; delete c.dataset.topicMatch; });
    
    const result = { unclassifiedPosts: [], containers: [] };
    for (const container of containers) {
        const postElement = config.getPostElement(container);
        const postId = postElement && config.getPostId(postElement);
        if (!postId) continue;
        
        const classification = await getClassification(postId);
        if (!forceReclassify && classification) {
            Object.assign(container.dataset, { topicMatch: JSON.stringify(classification), classified: 'true' });
            continue;
        }
        if (!classificationCache[postId]) {
            classificationCache[postId] = 'pending';
            result.unclassifiedPosts.push({ id: postId, text: config.getPostText(postElement) });
            result.containers.push(container);
        }
    }
    return result;
};

const processNewPosts = async (forceReclassify = false) => {
    try {
        const { GROQ_API_KEY, selectedTopics } = await getStorageData(['GROQ_API_KEY', 'selectedTopics']);
        if (!GROQ_API_KEY) throw new Error("Missing API key.");

        const { unclassifiedPosts, containers } = await findUnclassifiedPosts(config, forceReclassify);
        if (unclassifiedPosts.length === 0) return;

        const newClassifications = await classifyPosts(unclassifiedPosts, selectedTopics, GROQ_API_KEY);
        updateClassifications(newClassifications, containers);
        updatePostVisibility(selectedTopics);
    } catch (error) {
        console.error("Error processing new posts:", error, error.response?.data, error.response?.status);
    }
};

const updateClassifications = async (newClassifications, containers) => {
    Object.assign(classificationCache, newClassifications);
    await syncCacheToStorage();

    const { classifications: existingClassifications = {} } = await getStorageData(['classifications']);
    await setStorageData({ classifications: { ...existingClassifications, ...newClassifications } });

    containers.forEach(container => {
        const postElement = config.getPostElement(container);
        const postId = postElement && config.getPostId(postElement);
        const matchedTopics = postId && newClassifications[postId];
        if (matchedTopics) {
            const topicMatchArray = Array.isArray(matchedTopics) ? matchedTopics : [];
            Object.assign(container.dataset, { 
                topicMatch: JSON.stringify(topicMatchArray), 
                classified: 'true' 
            });
        }
    });
};

const updatePostVisibility = async (selectedTopics) => {
    if (!selectedTopics) ({ selectedTopics = [] } = await getStorageData(['selectedTopics']));
    document.querySelectorAll('[data-classified="true"]').forEach(el => {
        const topicMatch = JSON.parse(el.dataset.topicMatch);
        el.style.display = Array.isArray(topicMatch) && topicMatch.some(topic => selectedTopics.includes(topic)) ? 'none' : '';
    });
};

const classifyPosts = async (posts, topics, apiKey) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'classifyPosts', posts, topics, apiKey }, response => {
        if (response.success) {
            Object.entries(response.classifications).forEach(([postId, topics]) => {
                console.log(`Post ${postId}: ${topics.length > 0 ? topics.join(', ') : 'didn\'t match any topics'}\n${posts.find(post => post.id === postId).text}`);
            });
            resolve(response.classifications);
        } else {
            console.error('Error classifying posts:', response.error);
            reject(new Error(response.error));
        }
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'topicsUpdated') {
        getStorageData(['selectedTopics']).then(({ selectedTopics = [] }) => {
            const newTopics = selectedTopics.filter(topic => !lastKnownTopics.includes(topic));
            if (newTopics.length > 0) {
                chrome.storage.local.remove('classifications', () => {
                    lastKnownTopics = selectedTopics;
                    processNewPosts(true);
                });
            } else {
                updatePostVisibility(selectedTopics);
            }
            lastKnownTopics = selectedTopics;
        });
    } else if (request.action === 'clearClassificationCache') {
        classificationCache = {};
    }
});

getStorageData(['selectedTopics', 'classifications']).then(({ selectedTopics = [], classifications = {} }) => {
    lastKnownTopics = selectedTopics;
    classificationCache = classifications;
    config?.observeNewPosts?.(() => debounce(processNewPosts, 500)());
});

const getClassification = async (postId) => classificationCache[postId] || (await getStorageData(['classifications']))?.classifications?.[postId];

const syncCacheToStorage = async () => {
    await setStorageData({ classifications: classificationCache });
};