// src/services/whatsappService.js
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const dbService = require('./databaseService');
const geminiChatService = require('./geminiChatService.js');
const geminiFileService = require('./geminiFileService.js');
const geminiAnalysisService = require('./geminiAnalysisService.js');
const geminiImageService = require('./geminiImageService.js');
const clients = {};
const userDir = path.join(__dirname, '..', '..', 'user');
let centralBotWhatsappNumber = process.env.CENTRAL_BOT_NUMBER || '554284299123';
const XLSX = require('xlsx');

// --- CORREÇÃO: Adicionado um set para controlar sessões em inicialização ---
const initializingSessions = new Set();

if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir);
}

const sanitizeIdentifier = (id) => {
    if (!id || typeof id !== 'string') return '';
    return id.replace(/[\\/:\s]/g, '-');
}

/**
 * Inicializa um cliente WhatsApp para um usuário.
 * @param {string} sessionIdentifier - O identificador da sessão (geralmente o username).
 * @param {object|null} userObject - O objeto do usuário vindo do banco de dados.
 * @param {object|null} socket - O objeto de socket da conexão ativa, se houver.
 * @param {boolean} isCentralBot - Flag para identificar se é o bot central.
 */
async function initializeClient(sessionIdentifier, userObject, socket, isCentralBot = false) {
    const sanitizedIdentifier = sanitizeIdentifier(sessionIdentifier);
    if (!sanitizedIdentifier) {
        console.error("Erro: sessionIdentifier inválido ou não fornecido para initializeClient.");
        if (socket) socket.emit('error', 'ID de usuário inválido.');
        return;
    }

    // --- CORREÇÃO: Mecanismo de bloqueio para prevenir inicializações concorrentes ---
    if (initializingSessions.has(sanitizedIdentifier)) {
        console.warn(`[!] A inicialização para ${sanitizedIdentifier} já está em andamento. Nova tentativa ignorada para evitar conflitos.`);
        return;
    }

    try {
        initializingSessions.add(sanitizedIdentifier);

        if (clients[sanitizedIdentifier]) {
            console.log(`[?] Verificando sessão existente para ${sanitizedIdentifier}.`);
            const existingClient = clients[sanitizedIdentifier];

            let needsRestart = false;
            try {
                if (existingClient.pupBrowser && existingClient.pupBrowser.isConnected()) {
                    const state = await existingClient.getState();
                    if (state === 'CONNECTED') {
                        console.log(`[✅] Sessão para ${sanitizedIdentifier} está conectada. Reutilizando.`);
                        if (socket) {
                            existingClient.socket = socket;
                            socket.emit('ready');
                            socket.emit('log', 'Reconectado à sessão existente.');
                        }
                        // Libera o bloqueio se a sessão estiver boa
                        initializingSessions.delete(sanitizedIdentifier);
                        return;
                    }
                }
                console.warn(`[!] Sessão para ${sanitizedIdentifier} não está funcional. Marcada para reinicialização.`);
                needsRestart = true;
            } catch (e) {
                console.error(`[!] Erro crítico ao verificar sessão de ${sanitizedIdentifier}. Erro: ${e.message}`);
                needsRestart = true;
            }

            if (needsRestart) {
                console.log(`[!] Tentando destruir a sessão antiga para ${sanitizedIdentifier}...`);
                try {
                    if (existingClient && typeof existingClient.destroy === 'function') {
                        await existingClient.destroy();
                    }
                } catch (destroyError) {
                    console.error(`[!] Erro esperado ao destruir sessão corrompida. Ignorando. Erro: ${destroyError.message}`);
                } finally {
                    console.log(`[!] Removendo referência da sessão antiga de ${sanitizedIdentifier}.`);
                    delete clients[sanitizedIdentifier];
                }
            }
        }

        console.log(`Inicializando NOVA sessão para: ${sanitizedIdentifier}`);

        const client = new Client({
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: false, // Mudar para false
            },
            authStrategy: new LocalAuth({ clientId: sanitizedIdentifier, dataPath: userDir })
        });
        client.isUserClient = !isCentralBot;
        client.whatsappNumber = null;
        client.user = userObject;

        client.on('qr', (qr) => {
            if (isCentralBot) {
                qrcode.toString(qr, { type: 'terminal', small: true });
            } else if (socket) {
                socket.emit('log', 'QR Code gerado. Por favor, escaneie.');
                qrcode.toDataURL(qr, (err, url) => {
                    if (err) return socket.emit('error', 'Erro ao gerar QR Code.');
                    socket.emit('qr', url);
                });
            }
        });

        client.on('ready', async () => {
            const whatsappNumber = client.info.wid.user;
            client.whatsappNumber = whatsappNumber;
            console.log(`Cliente ${sanitizedIdentifier} conectado! Número: ${whatsappNumber}`);
            if (socket) {
                socket.emit('ready');
                socket.emit('log', `Conectado com sucesso com o número: ${whatsappNumber}`);
            }

            try {
                if (isCentralBot) {
                    centralBotWhatsappNumber = whatsappNumber;
                    console.log(`BOT CENTRAL conectado com o número: ${centralBotWhatsappNumber}`);
                } else if (client.user && (client.user.id || client.user.userId)) {
                    const userId = client.user.id || client.user.userId;
                    dbService.updateUserWhatsappNumber(userId, whatsappNumber);
                    client.user.command_whatsapp_number = whatsappNumber;
                    client.user.clientId = whatsappNumber;
                    console.log(`[WhatsApp Service] SUCESSO: Associação no DB para ${client.user.username} concluída.`);
                }
                dbService.getUserDb(whatsappNumber);
                console.log(`Estrutura de dados garantida para o cliente: ${whatsappNumber}`);
            } catch (error) {
                console.error(`Erro na configuração pós-ready para ${sanitizedIdentifier}:`, error);
            }
        });

        client.on('disconnected', async (reason) => {
            console.log(`Cliente ${sanitizedIdentifier} desconectado:`, reason);
            if (clients[sanitizedIdentifier]) {
                try {
                    await clients[sanitizedIdentifier].destroy();
                } catch (e) {
                    // Ignora erros aqui, pois a sessão já pode estar morta
                }
                delete clients[sanitizedIdentifier];
            }
            if (isCentralBot) {
                centralBotWhatsappNumber = null;
            }
            if (socket) socket.emit('disconnected');
        });

        client.on('message_create', async (message) => {
            if (message.fromMe && message.body.includes('🔍')) {
                const clientPhoneNumber = message.to.replace('@c.us', '').substring(2);
                const searchCommand = `!buscar ${clientPhoneNumber}`;
                await client.sendMessage(getCentralBotWhatsappNumber() + '@c.us', searchCommand);
                console.log(`[Central Bot] Disparado comando de busca para ${clientPhoneNumber} via emoji.`);
                return;
            }
        });

        client.on('message', async (message) => {
            if (!message.fromMe) {
                try {
                    if (message.from.endsWith('@c.us')) {
                        const chat = await message.getChat();
                        await chat.unarchive();
                    }
                } catch (error) {
                    console.error(`[WhatsApp Service] Erro ao tentar desarquivar o chat para ${message.from.replace('@c.us', '')}:`, error);
                }
            }

            const commandService = require('./commandService');
            if (!isCentralBot) {
                return;
            }
            if (!message.from.includes('@c.us')) return;

            try {
                const senderNumber = message.from.replace('@c.us', '');
                let user = dbService.findUserByWhatsappNumber(senderNumber);

                if (!user) {
                    if (message.body.startsWith('.') || message.body.startsWith('!')) {
                        return message.reply('❌ Seu número de WhatsApp não está associado a uma conta. Por favor, faça login no painel web primeiro para registrar seu número.');
                    }
                    return;
                }

                dbService.getUserDb(senderNumber);
                const userSanitizedIdentifier = sanitizeIdentifier(user.username);
                const userSocket = clients[userSanitizedIdentifier]?.socket || null;
                await commandService.handleCommand(message, user, senderNumber, userSocket, getCentralBotWhatsappNumber());

            } catch (error) {
                console.error('[Central Bot] Erro no manipulador de mensagens:', error);
                await message.reply('❌ Ocorreu um erro interno ao processar seu comando.');
            }

            if (message.hasMedia && message.body.toLowerCase().startsWith('!analisar') && isCentralBot) {
                const prompt = message.body.substring(10) + ', responda em portugues, curtas e diretas.';
                try {
                    const media = await message.downloadMedia();
                    if (media && media.mimetype.startsWith('image/')) {
                        const filePath = `./temp_media.${media.mimetype.split('/')[1]}`;
                        fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
                        const analysisResult = await geminiFileService.analyzeFile(prompt, filePath, media.mimetype);
                        message.reply(analysisResult);
                        fs.unlinkSync(filePath);
                    } else {
                        message.reply("Por favor, envie uma imagem válida para análise.");
                    }
                } catch (error) {
                    console.error("Erro ao baixar ou analisar mídia:", error);
                    message.reply("Ocorreu um erro ao processar sua imagem.");
                }
                return;
            }
        });

        await client.initialize();

        client.socket = socket;
        clients[sanitizedIdentifier] = client;
        console.log(`Cliente para ${sanitizedIdentifier} adicionado à lista de clientes ativos.`);

    } catch (err) {
        console.error(`Falha CRÍTICA ao inicializar cliente para ${sanitizedIdentifier}:`, err);
        if (socket) {
            socket.emit('error', 'Falha grave ao inicializar a sessão do WhatsApp. Tente novamente.');
        }
    } finally {
        // --- CORREÇÃO: Garante que o bloqueio seja removido ao final do processo ---
        initializingSessions.delete(sanitizedIdentifier);
    }
}

function getClient(id) {
    const sanitizedId = sanitizeIdentifier(id);
    return clients[sanitizedId];
}

function getCentralBotWhatsappNumber() {
    return centralBotWhatsappNumber;
}

process.on('exit', dbService.closeAllConnections);
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

module.exports = {
    initializeClient,
    getClient,
    clients,
    getCentralBotWhatsappNumber,
    sanitizeIdentifier
};
