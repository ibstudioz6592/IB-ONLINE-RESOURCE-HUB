/**
 * Vercel Serverless Function to proxy requests to Grok & Gemini APIs.
 * Place this file in the /api directory.
 */
export default async function handler(req, res) {
  // 1. Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 2. Get input from frontend
    const { ai, history, messages } = req.body;
    if (!ai) {
      return res.status(400).json({ error: "Missing 'ai' field (grok or gemini)" });
    }

    // Support both history[] and messages[]
    const chatHistory = history || messages;
    if (!chatHistory || !Array.isArray(chatHistory)) {
      return res.status(400).json({ error: "Invalid chat history provided" });
    }

    let url = "";
    let headers = { "Content-Type": "application/json" };
    let body = {};

    // 3. GROK branch
    if (ai === "grok") {
      const GROQ_API_KEY = process.env.GROQ_API_KEY;
      if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "GROQ_API_KEY not set" });
      }

      url = "https://api.groq.com/openai/v1/chat/completions";
      headers.Authorization = `Bearer ${GROQ_API_KEY}`;

      body = {
        model: "llama-3.3-70b-versatile", // default Grok model
        messages: chatHistory.map(m => ({
          role: m.role || (m.sender === "ai" ? "assistant" : "user"),
          content: m.content || m.text
        }))
      };
    }

    // 4. GEMINI branch
    else if (ai === "gemini") {
      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY not set" });
      }

      url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

      let systemInstruction = null;
      const contents = chatHistory
        .map(turn => {
          if (turn.role === "system") {
            systemInstruction = { parts: [{ text: turn.content || turn.text }] };
            return null;
          }
          return {
            role: turn.role === "assistant" ? "model" : "user",
            parts: [{ text: turn.content || turn.text }]
          };
        })
        .filter(Boolean);

      body = {
        contents,
        ...(systemInstruction && { systemInstruction }),
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 1,
          topP: 1,
          maxOutputTokens: 1024
        }
      };
    }

    // 5. Invalid AI
    else {
      return res.status(400).json({ error: "Unknown AI selected" });
    }

    // 6. Call the API
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Error:", errorText);
      return res.status(response.status).json({
        error: "Upstream API error",
        details: errorText
      });
    }

    const data = await response.json();

    // 7. Extract AI response
    let botResponse = "No response";
    if (ai === "grok") {
      botResponse = data.choices?.[0]?.message?.content || "No response";
    } else if (ai === "gemini") {
      if (data.candidates?.[0]?.content?.parts) {
        botResponse = data.candidates[0].content.parts.map(p => p.text).join("\n");
      } else {
        botResponse =
          `I am unable to provide a response. Reason: ${data.promptFeedback?.blockReason || "Unknown"}`;
      }
    }

    return res.status(200).json({ response: botResponse });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}
