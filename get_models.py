import requests
import os
import json

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY environment variable not set.")

url = "https://generativelanguage.googleapis.com/v1/models"
params = {"key": api_key}

response = requests.get(url, params=params)

if response.status_code == 200:
    models_data = response.json()
    models = models_data.get("models", [])
    if models:
        for model in models:
            print(f"Model Name: {model.get('name')}")
            print(f"Display Name: {model.get('displayName')}")
            print(f"Description: {model.get('description')}")
            print("-" * 20)
    else:
        print(json.dumps(models_data, indent=2))
        print("No models found in the response.")
else:
    print(f"Error fetching models: {response.status_code} - {response.text}")
