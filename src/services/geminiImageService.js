// src/services/geminiImageService.js
require('dotenv').config();
// A dependência 'node-fetch' é necessária para versões mais antigas do Node.js.
// Se estiver a usar Node.js v18+, pode remover esta linha e usar o fetch global.
const fetch = require('node-fetch'); 

/**
 * Gera uma imagem a partir de uma descrição de texto usando a API do Imagen.
 * @param {string} prompt - A descrição da imagem a ser gerada.
 * @returns {Promise<Buffer>} Um buffer com os dados da imagem gerada em formato PNG.
 */
async function generateImageFromText(prompt) {
    // PASSO 1: Validação do Prompt e da Chave de API
    if (!prompt || prompt.trim() === '') {
        throw new Error("A descrição da imagem não pode estar vazia.");
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("A chave da API do Gemini (GEMINI_API_KEY) não está configurada no seu ficheiro .env");
    }

    // PASSO 2: Preparação da Requisição para a API
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
    const payload = {
        instances: [{
            prompt: prompt
        }],
        parameters: {
            "sampleCount": 1
        }
    };

    try {
        // PASSO 3: Chamada à API
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // PASSO 4: Tratamento da Resposta
        if (!response.ok) {
            const errorBody = await response.json();
            console.error("Erro da API do Imagen:", JSON.stringify(errorBody, null, 2));
            // Fornece uma mensagem de erro mais útil
            throw new Error(`A API retornou um erro ${response.status} (${response.statusText}). Verifique se a API Vertex AI está ativada no seu projeto Google Cloud e se a sua chave tem as permissões corretas.`);
        }

        const result = await response.json();

        if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
            // Sucesso: Converte a imagem de base64 para um Buffer
            return Buffer.from(result.predictions[0].bytesBase64Encoded, 'base64');
        } else {
            // A resposta não veio como esperado
            throw new Error("A resposta da API não continha os dados da imagem esperados.");
        }

    } catch (error) {
        console.error("Erro detalhado ao gerar imagem com a API do Imagen:", error);
        // Propaga a mensagem de erro final para o WhatsApp
        throw new Error(error.message);
    }
}

module.exports = { generateImageFromText };
