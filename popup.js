const defaultTopics = ["politics", "negativity", "noise", "clickbait"];

function loadSettings() {
    chrome.storage.sync.get(['topics', 'GROQ_API_KEY'], ({ topics = defaultTopics, GROQ_API_KEY = '' }) => {
        document.getElementById('topicsInput').value = topics.join(', ');
        document.getElementById('apiKey').value = GROQ_API_KEY;
    });
}

function saveSettings() {
    const topics = document.getElementById('topicsInput').value.split(',').map(topic => topic.trim()).filter(Boolean);
    
    chrome.storage.sync.set({ topics }, () => {
        showMessage('Settings saved successfully!');
        chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => {
            chrome.tabs.sendMessage(tab.id, {action: "reloadSettings"});
        });
    });
}

function saveApiKey() {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (apiKey) {
        chrome.storage.sync.set({ GROQ_API_KEY: apiKey }, () => {
            showMessage('API Key saved successfully!');
            // Remove the line that hides apiKeySection
        });
    } else {
        showMessage('Please enter a valid API Key.');
    }
}

function showMessage(message) {
    const messageElement = document.getElementById('message');
    messageElement.textContent = message;
    messageElement.style.display = 'block';
    setTimeout(() => messageElement.style.display = 'none', 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    document.getElementById('save').addEventListener('click', saveSettings);
    document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
});