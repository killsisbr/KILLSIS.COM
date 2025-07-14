// src/services/geminiAnalysisService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mapeamentoConfig = require('../config/mapeamento');
require('dotenv').config();

// Configure a API do Gemini com sua chave
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Analisa os dados de uma planilha usando a API do Gemini para mapear e limpar os dados.
 * @param {Array<Object>} messyData - Um array de objetos representando as linhas da planilha bagunçada.
 * @returns {Promise<Array<Object>>} - Uma promessa que resolve para um array de objetos com os dados limpos e mapeados.
 */
async function analyzeAndMapSheet(messyData) {
    // Usando um modelo válido e recente
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Converte os dados e o esquema de mapeamento para string para enviar no prompt
    const dataString = JSON.stringify(messyData.slice(0, 20), null, 2); // Limita a 20 linhas para o prompt não ficar gigante
    const schemaString = JSON.stringify(mapeamentoConfig, null, 2);

    const prompt = `
        Você é um assistente especialista em limpeza e mapeamento de dados. Sua tarefa é analisar um JSON de uma planilha com cabeçalhos "bagunçados" e mapeá-lo para um esquema de dados limpo e predefinido.
        caso falte algum cabeçalho importante como "cpf" "nome", pode criar, e caso não tenha DDD_01, pegue do "telefone" os 2 primeiros digitos, e remova esses dois digitos do cabeçalho "telefone" e veja se tem 8 numeros nele, caso nao tenha, remova o primeiro 9, até ficar com 8 digitos.

        **Regras:**
        1.  Analise o JSON de entrada ("Dados da Planilha").
        2.  Use o "Esquema de Mapeamento" para entender quais cabeçalhos de entrada correspondem aos campos de saída. Por exemplo, se o esquema diz que "nascimento" pode ser "dt_nascimento" ou "data_nascimento", você deve usar o valor encontrado nesses campos para preencher o campo "nascimento" na saída.
        3.  Os campos de saída obrigatórios são: ${Object.keys(mapeamentoConfig).join(', ')}.
        4.  caso apenas tenha campo Telefone, ou Telefone_movel_01, telefone_movel_02, telefone_movel_03, analise para separar o ddd desses cabeçalhos em DDD_01, DDD_02, DDD_03, e o analise se o numero restante tem 8 digitos, caso nao tenha, remova o primeiro numero dps do ddd movido, até ficar com 8.
        5.  A sua resposta DEVE SER APENAS o array JSON de objetos mapeados, sem nenhum texto, explicação ou formatação extra como \`\`\`json.

        **Esquema de Mapeamento (Seu Guia):**
        ${schemaString}

        **Dados da Planilha (Entrada):**
        ${dataString}
        Agora, processe os "Dados da Planilha" e retorne o array JSON limpo e mapeado.
        e sempre fale as modificações e mudanças.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Limpa a resposta para garantir que seja um JSON válido
        const jsonMatch = text.match(/(\[[\s\S]*\])/);
        if (jsonMatch) {
            text = jsonMatch[0];
        }

        return JSON.parse(text);
    } catch (error) {
        console.error("Erro ao chamar a API do Gemini:", error);
        throw new Error("Falha ao analisar a planilha com a IA.");
    }
}

module.exports = { analyzeAndMapSheet };
