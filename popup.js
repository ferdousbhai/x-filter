const defaultTopics = ["politics", "negativity", "noise", "clickbait"];

const loadSettings = async () => {
    const { topics = [], GROQ_API_KEY = '' } = await chrome.storage.sync.get(['topics', 'GROQ_API_KEY']);
    const currentTopics = topics.length > 0 ? topics : defaultTopics;

    document.getElementById('topicsInput').value = currentTopics.join(', ');
    document.getElementById('apiKey').value = GROQ_API_KEY;

    if (topics.length === 0) {
        await chrome.storage.sync.set({ topics: defaultTopics });
    }
};

const showNotification = (message, duration = 3000) => {
    const notificationElement = document.getElementById('notification');
    notificationElement.textContent = message;
    notificationElement.classList.remove('hidden');
    setTimeout(() => notificationElement.classList.add('hidden'), duration);
};

const saveSettings = () => {
    const topics = document.getElementById('topicsInput').value.split(',').map(topic => topic.trim()).filter(Boolean);
    chrome.storage.sync.set({ topics: topics.length > 0 ? topics : defaultTopics }, () => {
        showNotification('Settings saved successfully!');
        chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => 
            chrome.tabs.sendMessage(tab.id, {action: "reloadSettings"}));
    });
};

const saveApiKey = async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (apiKey) {
        try {
            await chrome.storage.sync.set({ GROQ_API_KEY: apiKey });
            showNotification('API Key saved successfully!');
        } catch (error) {
            console.error('Error saving API Key:', error);
            showNotification('Error saving API Key. Please try again.');
        }
    } else {
        showNotification('Please enter a valid API Key.');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    document.getElementById('save').addEventListener('click', saveSettings);
    document.getElementById('saveApiKey').addEventListener('click', saveApiKey);

    document.querySelector('.tooltip').addEventListener('click', () => {
        window.open('https://console.groq.com/keys', '_blank');
    });
});