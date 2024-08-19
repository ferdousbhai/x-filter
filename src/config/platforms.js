const platformConfigs = {
    'x.com': {
        observeTarget: 'main',
        postListContainerSelector: '[data-testid="cellInnerDiv"]',
        findPostElement: postId => document.querySelector(`[data-testid="cellInnerDiv"] a[href*="/status/${postId}"]`)?.closest('[data-testid="cellInnerDiv"]'),
        idExtractor: postElement => {
            const statusLink = postElement.querySelector('a[href*="/status/"]');
            return statusLink ? statusLink.href.split('/status/')[1] : null;
        },
        extractPostData: container => {
            const tweetArticle = container.querySelector('article[data-testid="tweet"]');
            if (!tweetArticle) return null;

            const tweetLink = tweetArticle.querySelector('a[href*="/status/"]');
            const tweetId = tweetLink?.href.split('/status/')[1];
            if (!tweetId) return null;

            const tweetTextElement = tweetArticle.querySelector('[data-testid="tweetText"]');
            const tweetText = tweetTextElement?.innerText.trim() || '';

            return { id: tweetId, text: tweetText };
        },
    },
    // ... other platform configs ...
};

const getPlatformConfig = () => {
    const hostname = window.location.hostname;
    return platformConfigs[hostname] || platformConfigs[hostname.replace('www.', '')];
};