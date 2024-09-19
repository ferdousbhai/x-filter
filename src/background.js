const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';
const MAX_BATCH_SIZE = 30;

const runtime = chrome.runtime || browser.runtime;

const ENABLED_ICON = {
    16: "../icons/icon16.png",
    48: "../icons/icon48.png",
    128: "../icons/icon128.png"
  };
  
  const DISABLED_ICON = {
    16: "../icons/icon16_disabled.png",
    48: "../icons/icon48_disabled.png",
    128: "../icons/icon128_disabled.png"
  };
  
  async function updateExtensionState(isEnabled) {
    const iconPath = isEnabled ? ENABLED_ICON : DISABLED_ICON;
  
    try {
      await chrome.action.setIcon({ path: iconPath });
      await chrome.storage.local.set({ extensionEnabled: isEnabled });

      await chrome.contextMenus.update("toggleExtension", {
        title: isEnabled ? 'Disable Extension' : 'Enable Extension'
      });
  
    } catch (error) {
      console.error('Error updating extension state:', error);
    }
  }
  
  const initializeExtensionState = async () => {
    const { extensionEnabled = true } = await chrome.storage.local.get("extensionEnabled");
    await updateExtensionState(extensionEnabled);
  };
  
  chrome.runtime.onInstalled.addListener(() => {
      chrome.contextMenus.create({
          id: "toggleExtension",
          title: "Disable Extension",
          contexts: ["action"]
      });
      initializeExtensionState();
  });
  
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "toggleExtension") {
    toggleExtension();
  }
});

async function toggleExtension() {
  try {
    const { extensionEnabled = true } = await chrome.storage.local.get("extensionEnabled");
    const newState = !extensionEnabled;
    
    console.log("Current extension state:", extensionEnabled);
    console.log("Toggling extension to:", newState);
    
    await updateExtensionState(newState);
    console.log("Extension state updated successfully");
    
    // Notify content script about the state change
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'extensionStateChanged', enabled: newState });
      } catch (error) {
        console.warn(`Could not send message to tab ${tab.id}:`, error.message);
        // If the error is due to the receiving end not existing, it's not critical
        // so we'll just log a warning and continue
      }
    }
  } catch (error) {
    console.error("Error toggling extension state:", error);
  }
}

runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'classifyPosts') {
    chrome.storage.local.get("extensionEnabled", async ({ extensionEnabled = true }) => {
      if (!extensionEnabled) {
        sendResponse({ success: false, error: "Extension is disabled" });
        return;
      }
      
      try {
        const classifications = await classifyPosts(request.posts, request.topics, request.apiKey);
        sendResponse({ success: true, classifications: Object.fromEntries(classifications) });
      } catch (error) {
        console.error("Classification error:", error);
        sendResponse({ success: false, error: error.message });
      }
    });
    return true; // Indicates that the response is sent asynchronously
  }
});

const truncateText = (text, maxLength = 280) => 
    text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;

const classifyPosts = async (posts, topics, apiKey) => {
    if (!posts || posts.length === 0) {
        throw new Error("No posts provided for classification");
    }
    if (!topics || topics.length === 0) {
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
            if (!choices || choices.length === 0 || !choices[0].message || !choices[0].message.content) {
                throw new Error("Invalid response format from API");
            }
            const parsedContent = JSON.parse(choices[0].message.content);
            Object.entries(parsedContent).forEach(([postId, topics]) => {
                classifications.set(postId, Array.isArray(topics) ? topics : []);
            });
        } catch (error) {
            console.error("Error classifying posts:", error);
            throw error; // Propagate the error
        }
        if (i + MAX_BATCH_SIZE < posts.length) await new Promise(resolve => setTimeout(resolve, 500)); // 0.5s
    }
    return classifications;
};