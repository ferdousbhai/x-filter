const loadSettings = async () => {
    const { selectedTopics = [], GROQ_API_KEY, topicButtonsEnabled = false } = await chrome.storage.local.get(['selectedTopics', 'GROQ_API_KEY', 'topicButtonsEnabled']);
    renderTopicButtons(selectedTopics);
    updateTopicButtonsState(!!GROQ_API_KEY);
    document.getElementById('api-key').value = GROQ_API_KEY || '';
};

const saveApiKey = async () => {
    const apiKey = document.getElementById('api-key').value.trim();
    const isValid = await validateGroqApiKey(apiKey);
    await chrome.storage.local.set({ GROQ_API_KEY: isValid ? apiKey : '', topicButtonsEnabled: isValid });
    showNotification(isValid ? 'API key saved!' : 'Invalid API key.', isValid ? 1500 : 5000);
    updateTopicButtonsState(isValid);
};

const validateGroqApiKey = async (apiKey) => {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        return response.ok;
    } catch (error) {
        console.error('Error validating Groq API key:', error);
        return false;
    }
};

const showNotification = (message, duration = 2000) => {
    const notificationElement = document.getElementById('notification');
    document.getElementById('notification-message').textContent = message;
    notificationElement.classList.remove('hidden');
    
    clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(() => notificationElement.classList.add('hidden'), duration);
};

const renderTopicButtons = (selectedTopics) => {
    const container = document.getElementById('topics-container');
    container.innerHTML = TOPICS.map(topic => `
        <button class="topic-button ${selectedTopics.includes(topic) ? 'selected' : ''}" 
                data-topic="${topic}">
            ${topic}
        </button>
    `).join('');
    
    container.addEventListener('click', (e) => {
        if (e.target.classList.contains('topic-button')) {
            toggleTopic(e.target);
        }
    });
};

const updateTopicButtonsState = (isApiKeyValid) => {
    const topicButtons = document.querySelectorAll('.topic-button');
    const topicsSection = document.getElementById('topics-section');
    
    topicButtons.forEach(button => button.disabled = !isApiKeyValid);
    topicsSection.classList.toggle('disabled', !isApiKeyValid);
};

const toggleTopic = async (button) => {
    button.classList.toggle('selected');
    await saveTopicFilters();
    chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => {
        chrome.tabs.sendMessage(tab.id, {action: "updateVisibility"});
    });
};

const saveTopicFilters = async () => {
    const selectedTopics = [...document.querySelectorAll('.topic-button.selected')].map(btn => btn.dataset.topic);
    await chrome.storage.local.set({ selectedTopics }).catch(console.error);
};

document.addEventListener('DOMContentLoaded', () => {
    loadSettings().catch(console.error);
    document.querySelector('.tooltip')?.addEventListener('click', () => window.open('https://console.groq.com/keys', '_blank'));    
    document.getElementById('api-key')?.addEventListener('input', debounce(saveApiKey, 500));
});