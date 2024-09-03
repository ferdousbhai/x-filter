const platformConfigs = {
    'x.com': {
        postContainer: '[data-testid="cellInnerDiv"]',
        getPostElement: container => container.querySelector('article[data-testid="tweet"]'),
        getPostId: postElement => {
            const tweetIdElement = postElement.querySelector('a[href*="/status/"]');
            return tweetIdElement ? new URL(tweetIdElement.href).pathname.split('/').pop() : null;
        },
        getPostText: postElement => postElement.querySelector('[data-testid="tweetText"]')?.textContent.trim() || '',
        observeNewPosts: function(callback) {
            const processedPosts = new Set();
            const observer = new MutationObserver(mutations => {
                const newPosts = mutations
                    .flatMap(mutation => Array.from(mutation.addedNodes))
                    .filter(node => node.nodeType === Node.ELEMENT_NODE && 
                                    node.matches(this.postContainer) && 
                                    !processedPosts.has(node));
                
                if (newPosts.length > 0) {
                    newPosts.forEach(post => processedPosts.add(post));
                    callback(newPosts);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
            return observer;
        },
    },
    // ... other platform configs ...
};

const getPlatformConfig = () => {
    return platformConfigs[window.location.hostname];
}