/**
 * Vercel Serverless Function to securely proxy requests to the Google Gemini API.
 * This file should be placed in the /api directory of your project.
 */
export default async function handler(req, res) {
  // 1. Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 2. Get the chat history from the request body
    const { history } = req.body;
    if (!history || !Array.isArray(history)) {
      return res.status(400).json({ error: "Invalid 'history' array provided in payload" });
    }

    // 3. Securely get the Gemini API Key from Vercel Environment Variables
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set in environment variables.");
      return res.status(500).json({ error: "Server configuration error: API key not set" });
    }

    // 4. Define the Gemini API endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    // 5. Transform the frontend history to the format Gemini API expects
    let systemInstruction = null;
    const contents = history
      .map(turn => {
        // Extract the system instruction to be sent separately
        if (turn.role === 'system') {
          systemInstruction = {
            parts: [{ text: turn.content }],
          };
          return null; // Remove it from the main 'contents' array
        }
        return {
          role: turn.role === 'assistant' ? 'model' : 'user', // Map frontend roles to Gemini roles
          parts: [{ text: turn.content }],
        };
      })
      .filter(Boolean); // Filter out null entries (the system message)

    // Construct the final payload for the Gemini API
    const geminiPayload = {
      contents,
      ...(systemInstruction && { systemInstruction }), // Add system instruction if it exists
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
      generationConfig: {
        temperature: 0.7,
        topK: 1,
        topP: 1,
        maxOutputTokens: 2048,
      },
    };

    // 6. Make the request to the Gemini API
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API Error:", errorText);
      return res.status(response.status).json({ error: "Failed to get response from Gemini API.", details: errorText });
    }

    const data = await response.json();

    // 7. Extract the response text and send it back to the frontend
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
      const botResponse = data.candidates[0].content.parts[0].text;
      return res.status(200).json({ response: botResponse });
    } else {
       // Handle cases where the response is blocked by safety settings
       const blockReason = data.promptFeedback?.blockReason || 'No content';
       const responseText = `I am unable to provide a response. Reason: ${blockReason}. Please try rephrasing your question.`;
       return res.status(200).json({ response: responseText });
    }

  } catch (err) {
    console.error("Server error in /api/chat:", err);
    return res.status(500).json({ error: "An unexpected server error occurred.", details: err.message });
  }
}
