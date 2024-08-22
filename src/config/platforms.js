const platformConfigs = {
    'x.com': {
        postContainer: '[data-testid="cellInnerDiv"]',
        getPostElement: (container) => container.querySelector('article[data-testid="tweet"]'),
        getPostId: (postElement) => {
            const tweetIdElement = postElement.querySelector('a[href*="/status/"]');
            return tweetIdElement ? new URL(tweetIdElement.href).pathname.split('/').pop() : null;
        },
        getPostText: (postElement) => {
            const tweetTextElement = postElement.querySelector('[data-testid="tweetText"]');
            return tweetTextElement?.textContent.trim() || '';
        },
    },
    // ... other platform configs ...
};

const getPlatformConfig = () => {
    const hostname = window.location.hostname;
    return platformConfigs[hostname] || platformConfigs[hostname.replace('www.', '')];
};