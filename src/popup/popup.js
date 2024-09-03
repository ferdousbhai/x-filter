const DEFAULT_SELECTED_TOPICS = ["nsfw", "spam", "controversy", "clickbait", "politics"];
const MAX_SELECTED_TOPICS = 20;
const storage = chrome.storage.local;

const loadSettings = async () => {
    const { GROQ_API_KEY, selectedTopics = DEFAULT_SELECTED_TOPICS } = await storage.get(['GROQ_API_KEY', 'selectedTopics']);
    if (!selectedTopics.length) await storage.set({ selectedTopics: DEFAULT_SELECTED_TOPICS });
    renderTopicButtons(selectedTopics);
    const topicsSection = document.getElementById('topics-section');
    topicsSection.classList.toggle('disabled', !GROQ_API_KEY);
    document.getElementById('api-key').value = GROQ_API_KEY || '';
};

const saveApiKey = async () => {
    const apiKey = document.getElementById('api-key').value.trim();
    const isValid = await validateApiKey(apiKey);
    await storage.set({ GROQ_API_KEY: isValid ? apiKey : '' });
    showNotification(isValid ? 'API key saved!' : 'Invalid API key.', isValid ? 1500 : 5000);
    document.getElementById('topics-section').classList.toggle('disabled', !isValid);
};

const validateApiKey = async (apiKey) => {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        return res.ok;
    } catch {
        return false;
    }
};

const showNotification = (message, duration = 2000) => {
    const notificationElement = document.getElementById('notification');
    document.getElementById('notification-message').textContent = message;
    notificationElement.classList.remove('hidden');
    setTimeout(() => notificationElement.classList.add('hidden'), duration);
};

const renderTopicButtons = (selectedTopics) => {
    document.getElementById('topics-container').innerHTML = selectedTopics.map(topic => 
        `<button class="topic-button" data-topic="${topic}">${topic}</button>`
    ).join('');
};

const updateSelectedTopics = async (newSelectedTopics) => {
    const { selectedTopics: oldSelectedTopics } = await storage.get(['selectedTopics']);
    await storage.set({ selectedTopics: newSelectedTopics });
    renderTopicButtons(newSelectedTopics);
    if (JSON.stringify(oldSelectedTopics) !== JSON.stringify(newSelectedTopics)) {
        await clearClassifications();
    }
    chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => {
        tab && chrome.tabs.sendMessage(tab.id, {action: "topicsUpdated"});
    });
};

const addTopic = async () => {
    const newTopics = document.getElementById('new-topic').value
        .toLowerCase()
        .split(',')
        .map(t => t.trim())
        .filter(t => /^[a-z0-9-]+$/.test(t));
    const { selectedTopics = DEFAULT_SELECTED_TOPICS } = await storage.get(['selectedTopics']);
    const topicsToAdd = newTopics.filter(topic => !selectedTopics.includes(topic)).slice(0, MAX_SELECTED_TOPICS - selectedTopics.length);
    if (topicsToAdd.length) {
        await updateSelectedTopics([...selectedTopics, ...topicsToAdd]);
        document.getElementById('new-topic').value = '';
        await clearClassifications();
        showNotification(`Added ${topicsToAdd.length} new topic(s)!${topicsToAdd.length < newTopics.length ? ` Some couldn't be added due to the 20-topic limit.` : ''}`, 3000);
    } else {
        showNotification(selectedTopics.length >= MAX_SELECTED_TOPICS ? 'Topic limit reached!' : 'No new topics added.', 2000);
    }
};

const clearClassifications = async () => {
    await storage.remove('classifications');
    chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => {
        chrome.tabs.sendMessage(tab.id, {action: "clearClassificationCache"});
    });
};

document.addEventListener('DOMContentLoaded', () => {
    loadSettings().catch(console.error);
    document.querySelector('.tooltip')?.addEventListener('click', () => window.open('https://console.groq.com/keys', '_blank'));    
    document.getElementById('api-key')?.addEventListener('input', debounce(saveApiKey, 500));
    document.getElementById('add-topic-btn')?.addEventListener('click', addTopic);
    document.getElementById('new-topic')?.addEventListener('keypress', e => e.key === 'Enter' && addTopic());
    document.getElementById('restore-default-btn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to restore default topics?')) {
            await updateSelectedTopics(DEFAULT_SELECTED_TOPICS);
            await clearClassifications();
            showNotification('Default topics restored!', 2000);
        }
    });
    document.getElementById('topics-section')?.addEventListener('click', async (e) => {
        if (e.target.classList.contains('topic-button')) {
            const { selectedTopics } = await storage.get(['selectedTopics']);
            await updateSelectedTopics(selectedTopics.filter(t => t !== e.target.dataset.topic));
            await clearClassifications();
            showNotification('Topic removed and classifications cleared!', 2000);
        }
    });
});