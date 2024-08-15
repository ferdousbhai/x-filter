const DEFAULT_TOPICS = ["politics", "negativity", "noise", "clickbait"];

const loadSettings = async () => {
    const { topics, GROQ_API_KEY = '' } = await chrome.storage.sync.get(['topics', 'GROQ_API_KEY']);
    document.getElementById('topics-input').value = topics ? topics.join(', ') : DEFAULT_TOPICS.join(', ');
    document.getElementById('api-key').value = GROQ_API_KEY;
    validateApiKey(); 
};

const showNotification = (message, duration = 3000) => {
    const notificationElement = document.getElementById('notification');
    notificationElement.textContent = message;
    notificationElement.classList.remove('hidden');
    setTimeout(() => notificationElement.classList.add('hidden'), duration);
};

const saveSettings = async (key, value, validationFn = null) => {
    if (validationFn && !validationFn(value)) return;
    try {
        await chrome.storage.sync.set({ [key]: value });
        showNotification(`${key} saved successfully!`);
    } catch (error) {
        console.error(`Error saving ${key}:`, error);
        showNotification(`Error saving ${key}. Please try again.`);
    }
};

const saveTopicFilters = () => {
    const topicsInput = document.getElementById('topics-input').value.trim();
    let topics;
    
    if (topicsInput === '') {
        topics = []; // Empty list
    } else if (topicsInput === DEFAULT_TOPICS.join(', ')) {
        topics = null; // Use default topics
    } else {
        topics = topicsInput.split(',').map(topic => topic.trim()).filter(Boolean);
    }
    
    saveSettings('topics', topics, validateTopics);
};

const validateGroqApiKey = async (apiKey) => {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        return response.ok;
    } catch (error) {
        console.error('Error validating Groq API key:', error);
        return false;
    }
};

const saveApiKey = async () => {
    const apiKey = document.getElementById('api-key').value.trim();
    if (apiKey) {
        const isValid = await validateGroqApiKey(apiKey);
        if (isValid) {
            saveSettings('GROQ_API_KEY', apiKey);
            showNotification('API key validated and saved successfully!');
        } else {
            showNotification('Invalid API key. Please check and try again.', 5000);
        }
    }
};

const validateTopics = (topics) => {
    const invalidTopics = topics.filter(topic => topic && !/^[a-zA-Z\s]+$/.test(topic));
    if (invalidTopics.length > 0) {
        showNotification(`Invalid topics: ${invalidTopics.join(', ')}. Use only letters and spaces.`, 5000);
        return false;
    }
    return true;
};

function validateApiKey() {
    const apiKeyInput = document.getElementById('api-key');
    const topicsInput = document.getElementById('topics-input');
    const saveButton = document.getElementById('save-topics');

    const isEmpty = apiKeyInput.value.trim() === '';
    saveButton.disabled = isEmpty;
    topicsInput.disabled = isEmpty;
}

const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
};

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    document.querySelector('.tooltip')?.addEventListener('click', () => window.open('https://console.groq.com/keys', '_blank'));
    document.getElementById('save-topics')?.addEventListener('click', saveTopicFilters);
    
    const apiKeyInput = document.getElementById('api-key');
    apiKeyInput?.addEventListener('input', debounce(async () => {
        validateApiKey();
        await saveApiKey();
    }, 500));
});