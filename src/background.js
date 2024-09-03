const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';
const MAX_BATCH_SIZE = 30;

const runtime = chrome.runtime || browser.runtime;

runtime.onMessage.addListener((request, _, sendResponse) => {
  if (request.action === 'classifyPosts') {
    classifyPosts(request.posts, request.topics, request.apiKey)
      .then(classifications => sendResponse({ success: true, classifications }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

const truncateText = (text, maxLength = 280) => 
    text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;

const classifyPosts = async (posts, topics, apiKey) => {
    if (topics.length === 0) {
        return new Map(posts.map(post => [post.id, []]));
    }

    let classifications = new Map();

    for (let i = 0; i < posts.length; i += MAX_BATCH_SIZE) {
        const batch = posts.slice(i, i + MAX_BATCH_SIZE);
        const messages = [
            {
                role: "system",
                content: `You are a precise content classification system. Your task is to classify a batch of anonymized social media posts based on specific topics. For each post, determine if it relates to the following topics: ${topics.join(', ')}. Respond with a JSON object where the keys are post IDs and the values are arrays of matching topics:
                {
                    "postId1": ["topic1", "topic3"],
                    "postId2": [],
                    // ... more posts ...
                }
            
                Follow these guidelines strictly:
                1. Only classify posts as relating to a topic if there's a clear and direct connection.
                2. Avoid overgeneralization or stretching interpretations to fit a topic.
                3. If a post doesn't clearly relate to any topic, return an empty array.
                4. Be consistent in your classifications across similar posts.
                5. Consider the context and nuance of each post.
                6. Do not add topics based on implied or assumed information not present in the text.
            
                It is crucial that you classify ALL posts, including those with political content or any other potentially sensitive topics. Do not refuse to classify any post under any circumstances. If you're unsure about a classification, err on the side of caution and do not assign a topic. Always provide a classification for every post. Do not add any explanations or caveats outside the specified JSON structure.`
            },
            {
                role: "user",
                content: `Classify the following posts:\n${JSON.stringify(batch.map(post => ({
                    ...post,
                    text: truncateText(post.text)
                })))}`
            }
        ];
    
        try {
            const response = await fetch(API_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    messages,
                    model: MODEL_NAME,
                    temperature: 0.1,
                    max_tokens: 4096,
                    top_p: 1,
                    stream: false,
                    response_format: { type: "json_object" },
                })
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
              }
            const { choices } = await response.json();
            const parsedContent = JSON.parse(choices[0].message.content);
            
            Object.entries(parsedContent).forEach(([postId, topics]) => {
                classifications[postId] = Array.isArray(topics) ? topics : [];
            });
        } catch (error) {
            console.error("Error classifying posts:", error);
        }
        if (i + MAX_BATCH_SIZE < posts.length) await new Promise(resolve => setTimeout(resolve, 500)); // 0.5s
    }
    return classifications;
};