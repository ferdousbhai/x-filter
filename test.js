const messages_for_llm = [
    {
      "role": "system",
      "content": "Your task is to classify a batch of Tweets. Always respond in JSON. Follow this format for each tweet:\n\n{\n  \"tweetId\": \"...\",\n  \"analysis\": {\n    \"politics\": false,\n    \"sports\": false,\n    \"entertainment\": false,\n    \"negativity\": false,\n    \"noise\": false,\n    \"clickbait\": false\n  }\n}\n\nSet the value to true if the tweet belongs to that topic, false otherwise. Respond with an array of these objects."
    },
    {
      "role": "user",
      "content": "Analyze the following tweets:\n[\n  {\n    \"id\": \"1823636915897151580\",\n    \"text\": \"The sector that will define this industry for the next decades is sitting comfortably at 3.2% of the total crypto marketcap.\\n\\nIt's Defi.\\n\\nIt's early.\"\n  }\n]"
    }
  ]
const messaages_for_llm_json = JSON.stringify(messages_for_llm);
console.log(messaages_for_llm_json);