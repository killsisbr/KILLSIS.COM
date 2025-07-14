// src/services/commandService.js
const { MessageMedia } = require('whatsapp-web.js');
const commands = require('../config/commands');
const fs = require('fs');
const path = require('path');
const { startCampaign } = require('./campaignService');
const dbService = require('./databaseService');
const XLSX = require('xlsx');
const { sanitizeIdentifier } = require('./whatsappService');

const geminiChatService = require('./geminiChatService.js');
const geminiAnalysisService = require('./geminiAnalysisService.js');

const userDirBase = path.join(__dirname, '..', '..', 'user');

if (!fs.existsSync(userDirBase)) {
    fs.mkdirSync(userDirBase);
}

function ensureUserDirectoryExists(clientId) {
    const sanitizedClientId = sanitizeIdentifier(clientId);
    const specificUserDir = path.join(userDirBase, sanitizedClientId);
    if (!fs.existsSync(specificUserDir)) {
        fs.mkdirSync(specificUserDir, { recursive: true });
    }
}

function atualizarTexto(idChat, texto, msg) {
    ensureUserDirectoryExists(idChat);
    const filePath = path.join(userDirBase, idChat, 'mensagem.json');
    fs.writeFile(filePath, JSON.stringify(texto, null, 2), (err) => {
        if (err) {
            console.error('Erro ao salvar o arquivo JSON:', err);
            msg.reply('❌ Erro ao salvar o texto da mensagem.');
        } else {
            msg.reply('✅ Texto da mensagem salvo com sucesso!');
        }
    });
}

/**
 * Manipula uma mensagem recebida para verificar se é um comando e executá-lo.
 */
async function handleCommand(message, user, clientId, socket, centralBotWhatsappNumber) {
    const userMessage = message.body || '';
    const commandText = userMessage.trim().split(' ')[0].toLowerCase();
    const command = commands.find(cmd => cmd.command === commandText);

    // --- LÓGICA REESTRUTURADA ---
  // NOVO COMANDO !salvar
    if (userMessage.toLowerCase().startsWith('!salvar')) {
        if (!message.hasMedia) {
            return message.reply('❌ Para usar o comando !salvar, por favor, anexe uma planilha (.xlsx).');
        }

        const media = await message.downloadMedia();
        const validMimeTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];

        if (!media || !validMimeTypes.includes(media.mimetype)) {
            return message.reply('❌ Ficheiro inválido. Por favor, envie uma planilha no formato .xlsx ou .xls.');
        }

        try {
            await message.reply('⏳ A processar e a salvar a sua planilha... Isto pode demorar um momento.');
            
            const fileBuffer = Buffer.from(media.data, 'base64');
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            
            let sheetsProcessed = 0;
            for (const sheetName of workbook.SheetNames) {
                const worksheet = workbook.Sheets[sheetName];
                const sheetJson = XLSX.utils.sheet_to_json(worksheet);

                if (sheetJson.length > 0) {
                    await dbService.saveSheetToDatabase(clientId, sheetJson, sheetName);
                    sheetsProcessed++;
                }
            }

            if (sheetsProcessed > 0) {
                await message.reply(`✅ Sucesso! ${sheetsProcessed} aba(s) da sua planilha foram salvas no seu banco de dados.`);
            } else {
                await message.reply('🟡 A sua planilha parece estar vazia. Nenhum dado foi salvo.');
            }

        } catch (error) {
            console.error("Erro ao salvar planilha via comando !salvar:", error);
            message.reply("❌ Ocorreu um erro técnico ao salvar a sua planilha. Por favor, tente novamente ou contacte o suporte.");
        }
        return; // Encerra o processamento aqui
    }

    // 1. Verifica primeiro se a mensagem contém mídia
    if (message.hasMedia) {
        const media = await message.downloadMedia();
        const chat = await message.getChat();
        
        // 1.1 Comando explícito para CORRIGIR PLANILHA
        if (userMessage.toLowerCase().startsWith('!corrigir')) {
            chat.sendStateTyping();
            try {
                const validMimeTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];
                if (media && validMimeTypes.includes(media.mimetype)) {
                    await message.reply('🤖 Recebi sua planilha. Analisando com a IA, isso pode levar um momento...');
                    const fileBuffer = Buffer.from(media.data, 'base64');
                    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const sheetJson = XLSX.utils.sheet_to_json(worksheet);

                    if (sheetJson.length === 0) return message.reply('❌ Erro: A planilha está vazia.');

                    const cleanedData = await geminiAnalysisService.analyzeAndMapSheet(sheetJson);
                    if (!cleanedData || cleanedData.length === 0) return message.reply('❌ A IA não conseguiu processar os dados.');

                    const newSheet = XLSX.utils.json_to_sheet(cleanedData);
                    const newWorkbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(newWorkbook, newSheet, 'Corrigida');
                    const xlsxBuffer = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'buffer' });

                    const correctedMedia = new MessageMedia('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsxBuffer.toString('base64'), 'planilha_corrigida.xlsx');
                    await message.reply('✅ Análise concluída! Aqui está a sua planilha corrigida.', undefined, { media: correctedMedia });
                }
            } catch (error) {
                console.error("Erro ao analisar planilha via WhatsApp:", error);
                message.reply("❌ Ocorreu um erro ao processar sua planilha.");
            } finally {
                chat.clearState();
            }
            return; // Encerra o processamento
        }

        // 1.2 Upload padrão de arquivos (sem comando de texto)
        if (media.mimetype === 'audio/ogg; codecs=opus') {
            fs.writeFile(path.join(userDirBase, clientId, `audio.ogg`), media.data, 'base64', (err) => {
                if (err) console.error('Erro ao salvar o arquivo de áudio:', err);
                else message.reply('✅ Áudio para envio atualizado.');
            });
            return;
        }
        if (media.mimetype.startsWith('image/')) {
            const fileExtension = media.mimetype.split('/')[1];
            fs.writeFile(path.join(userDirBase, clientId, `imagem.${fileExtension}`), media.data, 'base64', (err) => {
                if (err) console.error('Erro ao salvar a imagem:', err);
                else message.reply('✅ Imagem salva para envio.');
            });
            return;
        }

        // 1.3 Lógica inteligente para upload de PLANILHA
        const validSheetTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
        if (validSheetTypes.includes(media.mimetype)) {
            const fileBuffer = Buffer.from(media.data, 'base64');
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const sheetHeaders = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 'A1:Z1' })[0] || [];
            const headers = sheetHeaders.map(h => String(h).toLowerCase().trim());
            
            const mandatoryHeaders = ['cpf', 'nome', 'ddd_01', 'tel_01'];
            const hasAllHeaders = mandatoryHeaders.every(h => headers.includes(h));

            if (hasAllHeaders) {
                // Se a planilha é válida, salva diretamente
                fs.writeFile(path.join(userDirBase, clientId, 'lista.xlsx'), fileBuffer, (err) => {
                    if (err) {
                        console.error('Erro ao salvar a planilha original:', err);
                        message.reply('❌ Erro ao salvar a planilha.');
                    } else {
                        message.reply('✅ Planilha válida recebida e salva com sucesso!');
                    }
                });
            } else {
                // Se não for válida, usa a IA para corrigir
                await message.reply('🟡 Planilha com formato incomum. Usando IA para corrigir, aguarde...');
                chat.sendStateTyping();
                try {
                    const jsonDataForAI = XLSX.utils.sheet_to_json(worksheet);
                    const cleanedData = await geminiAnalysisService.analyzeAndMapSheet(jsonDataForAI);

                    if (!cleanedData || cleanedData.length === 0) return message.reply('❌ A IA não conseguiu processar os dados. Verifique o formato.');

                    const newSheet = XLSX.utils.json_to_sheet(cleanedData);
                    const newWorkbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(newWorkbook, newSheet, 'Corrigida');
                    const newFileBuffer = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'buffer' });

                    fs.writeFile(path.join(userDirBase, clientId, 'lista.xlsx'), newFileBuffer, (err) => {
                        if (err) {
                            console.error('Erro ao salvar a planilha corrigida:', err);
                            message.reply('❌ Erro ao salvar a planilha corrigida.');
                        } else {
                            message.reply('✅ Planilha corrigida pela IA e salva com sucesso!');
                        }
                    });
                } catch (error) {
                    console.error("Erro no processo de análise da IA:", error);
                    message.reply("❌ Ocorreu um erro ao tentar corrigir a planilha com a IA.");
                } finally {
                    chat.clearState();
                }
            }
            return; // Encerra após tratar a planilha
        }
    }

    // 2. Verifica comandos de texto padrão
    if (command) {
        console.log(`[+] Comando '${command.command}' recebido de ${message.from} para o usuário ${user.username}`);
        try {
            await command.action(message, user, clientId, socket, centralBotWhatsappNumber, userDirBase, atualizarTexto, startCampaign, dbService, XLSX);
        } catch (error) {
            console.error(`Erro ao executar o comando '${command.command}':`, error);
            message.reply(`❌ Ocorreu um erro ao executar o comando ${command.command}.`);
        }
        return; // Encerra o processamento
    }
    
    // 3. Se nenhum comando foi encontrado, trata como uma conversa para a IA
    try {
        const prompt = message.body;
        if (!prompt) return; // Não responde a mensagens vazias

        const aiResponse = await geminiChatService.sendMessageToAI(clientId, prompt);
        message.reply(aiResponse);
    } catch (error) {
        console.error("Erro no fallback da IA:", error);
        message.reply("❌ Desculpe, ocorreu um erro ao contatar o assistente.");
    }
}

module.exports = {
    handleCommand,
};
