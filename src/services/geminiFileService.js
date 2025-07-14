const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest"});

/**
 * Converte um arquivo local para o formato que a API do Gemini entende.
 * @param {string} filePath - O caminho para o arquivo.
 * @param {string} mimeType - O tipo do arquivo (ex: 'image/jpeg', 'text/plain').
 * @returns {{inlineData: {data: string, mimeType: string}}}
 */
function fileToGenerativePart(filePath, mimeType) {
    return {
        inlineData: {
            data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
            mimeType
        },
    };
}

/**
 * Analisa o conteúdo de um arquivo (texto, imagem, etc.) usando uma instrução.
 * @param {string} prompt - A pergunta ou instrução sobre o arquivo (ex: "O que é isso?").
 * @param {string} filePath - O caminho para o arquivo a ser analisado.
 * @param {string} mimeType - O tipo do arquivo.
 * @returns {Promise<string>} A análise feita pela IA.
 */
async function analyzeFile(prompt, filePath, mimeType) {
    try {
        if (!fs.existsSync(filePath)) {
            return "❌ Erro: O arquivo não foi encontrado no servidor.";
        }

        const imageParts = [
            fileToGenerativePart(filePath, mimeType),
        ];

        const result = await model.generateContent([prompt, ...imageParts]);
        const response = result.response;
        return response.text();

    } catch (error) {
        console.error("Erro ao analisar arquivo com Gemini:", error);
        return "❌ Desculpe, tive um problema ao analisar o arquivo.";
    }
}

module.exports = { analyzeFile };