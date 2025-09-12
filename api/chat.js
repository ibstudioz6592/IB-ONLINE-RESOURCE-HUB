export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  try {
    const { ai, history, messages } = req.body;
    if (!ai) {
      return res.status(400).json({ error: "Missing 'ai' field (grok or gemini)" });
    }
    
    const chatHistory = history || messages;
    if (!chatHistory || !Array.isArray(chatHistory)) {
      return res.status(400).json({ error: "Invalid chat history provided" });
    }

    let url = "";
    let headers = { "Content-Type": "application/json" };
    let body = {};

    if (ai === "grok") {
      const GROQ_API_KEY = process.env.GROQ_API_KEY;
      if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "GROQ_API_KEY not set" });
      }
      
      url = "https://api.groq.com/openai/v1/chat/completions";
      headers.Authorization = `Bearer ${GROQ_API_KEY}`;
      body = {
        model: "llama-3.3-70b-versatile",
        messages: chatHistory.map(m => ({
          role: m.role || (m.sender === "ai" ? "assistant" : "user"),
          content: m.content || m.text
        })),
        stream: true // Enable streaming
      };
    } 
    else if (ai === "gemini") {
      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY not set" });
      }
      
      url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?key=${GEMINI_API_KEY}`;
      
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
    else {
      return res.status(400).json({ error: "Unknown AI selected" });
    }

    // Call the API with streaming enabled
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

    // Set up streaming response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
    
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}
