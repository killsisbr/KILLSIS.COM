
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Configuração inicial
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Modelo rápido e eficiente

// Gerenciador de histórico de conversas (essencial para um chat contínuo)
// Mapeia o ID do usuário (ex: número do WhatsApp) para o seu histórico
const chatHistories = new Map();

/**
 * Envia uma mensagem para o Gemini e retorna a resposta.
 * Mantém o histórico da conversa para dar contexto à IA.
 * @param {string} userId - Identificador único do usuário (ex: '5511999998888@c.us')
 * @param {string} userMessage - A mensagem enviada pelo usuário.
 * @returns {Promise<string>} A resposta do modelo de IA.
 */
async function sendMessageToAI(userId, userMessage) {
    try {
        // Pega ou cria uma nova sessão de chat para o usuário
        if (!chatHistories.has(userId)) {
            // Você pode adicionar um histórico inicial para definir o comportamento do bot
            const initialHistory = [
                {
                    role: "user",
                    parts: [{ text: "Olá. Você é um assistente virtual amigável." }],
                },
                {
                    role: "model",
                    parts: [{ text: "Olá! Sou seu assistente virtual. Como posso ajudar hoje?" }],
                },
            ];
            chatHistories.set(userId, model.startChat({ history: initialHistory }));
        }

        const chat = chatHistories.get(userId);
        const result = await chat.sendMessage(userMessage);
        const response = result.response;
        
        return response.text();

    } catch (error) {
        console.error("Erro ao comunicar com a API do Gemini:", error);
        return "❌ Desculpe, não consegui processar sua solicitação no momento.";
    }
}

module.exports = { sendMessageToAI };