const platformConfigs = {
    'x.com': {
        postContainer: '[data-testid="cellInnerDiv"]',
        findUnclassifiedPosts: () => 
            Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]:not([data-classified="true"])'))
                .map(container => {
                    const tweetArticle = container.querySelector('article[data-testid="tweet"]');
                    if (!tweetArticle) return null;
                
                    const tweetId = tweetArticle.querySelector('a[href*="/status/"]')?.href.split('/status/')[1];
                    if (!tweetId) return null;
                
                    const tweetText = tweetArticle.querySelector('[data-testid="tweetText"]')?.innerText.trim() || '';
                
                    return { id: tweetId, text: tweetText, element: container };
                })
                .filter(Boolean),
    },
    // ... other platform configs ...
};

const getPlatformConfig = () => {
    const hostname = window.location.hostname;
    return platformConfigs[hostname] || platformConfigs[hostname.replace('www.', '')];
};