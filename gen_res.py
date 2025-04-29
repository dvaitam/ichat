import requests
import json
import os

# Configure API key (replace with your actual key or set as environment variable)
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY environment variable not set.")

# Choose the Gemini model for chat
model_name = 'gemini-2.5-pro-exp-03-25'  # Or another suitable model
base_url = "https://generativelanguage.googleapis.com/v1beta"
endpoint = f"/models/{model_name}:generateContent"
url = f"{base_url}{endpoint}?key={api_key}"

# Initialize chat history (can be empty or pre-populated)
chat_history = [
    {"role": "user", "parts": [{"text": "Hello, how are you today?"}]},
    {"role": "model", "parts": [{"text": "I'm doing well, thank you for asking. How can I assist you?"}]}
]

def get_chat_response_rest(user_prompt, history):
    """Sends a user prompt and chat history to the Gemini REST API and returns the response."""
    headers = {'Content-Type': 'application/json'}
    # Include generationConfig to control response length and quality
    data = {
        "contents": history + [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.9,
            "topP": 0.8,
            "topK": 40,
            "maxOutputTokens": 1024
        },
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}
        ]
    }
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()  # Raise an exception for bad status codes
        response_json = response.json()
        if "candidates" in response_json and response_json["candidates"]:
            return response_json["candidates"][0]["content"]["parts"][0]["text"]
        else:
            return "No response from the model."
    except requests.exceptions.RequestException as e:
        print(f"An error occurred during the API request: {e}")
        return None
    except (KeyError, IndexError) as e:
        print(f"Error parsing the API response: {e}")
        return None

if __name__ == "__main__":
    print("Welcome to the Gemini Chatbot (REST API)!")
    while True:
        user_input = input("You: ")
        if user_input.lower() in ["quit", "exit", "bye"]:
            print("Goodbye!")
            break

        bot_response = get_chat_response_rest(user_input, chat_history)
        if bot_response:
            print(f"Bot: {bot_response}")
            chat_history.append({"role": "user", "parts": [{"text": user_input}]})
            chat_history.append({"role": "model", "parts": [{"text": bot_response}]})
        else:
            print("Bot: Sorry, I couldn't get a response.")
