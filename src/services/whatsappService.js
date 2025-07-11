// src/services/whatsappService.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const dbService = require('./databaseService');
// Importe os novos serviços
const geminiChatService = require('./geminiChatService.js');
const geminiFileService = require('./geminiFileService.js');

const clients = {};
const userDir = path.join(__dirname, '..', '..', 'user');
let centralBotWhatsappNumber = process.env.CENTRAL_BOT_NUMBER || '554284299123';

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
function initializeClient(sessionIdentifier, userObject, socket, isCentralBot = false) {
    const sanitizedIdentifier = sanitizeIdentifier(sessionIdentifier);
    if (!sanitizedIdentifier) {
        console.error("Erro: sessionIdentifier inválido ou não fornecido para initializeClient.");
        if (socket) {
            socket.emit('error', 'Ocorreu um erro interno ao iniciar a sessão (ID de usuário inválido).');
        }
        return;
    }

    
    // --- INÍCIO DA CORREÇÃO ---
    // Verifica se um cliente já existe e se ele está em um estado funcional (não é um "zumbi").
    if (clients[sanitizedIdentifier]) {
        const existingClient = clients[sanitizedIdentifier];
        
        // A presença de 'pupBrowser' é um bom indicador de que o cliente não foi destruído.
        if (existingClient.pupBrowser) {
            console.log(`Sessão para ${sanitizedIdentifier} já existe e está ativa. Tentando reconectar.`);
            if (socket) {
                existingClient.getState().then(state => {
                    if (state === 'CONNECTED') {
                        socket.emit('ready');
                        socket.emit('log', `Reconectado à sessão existente.`);
                    }
                }).catch(err => {
                    console.error(`Erro ao obter estado do cliente existente para ${sanitizedIdentifier}:`, err);
                });
            }
            return; // Impede a reinicialização se o cliente estiver saudável.
        } else {
            // Se o cliente existe mas não tem 'pupBrowser', é um zumbi.
            console.warn(`[FIX] Sessão "zumbi" para ${sanitizedIdentifier} encontrada. Removendo para recriar.`);
            delete clients[sanitizedIdentifier];
        }
    }

    console.log(`Inicializando sessão para: ${sanitizedIdentifier} (Original: ${sessionIdentifier}, Central Bot: ${isCentralBot})`);

    const client = new Client({
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true,
        },
        authStrategy: new LocalAuth({ clientId: sanitizedIdentifier, dataPath: userDir })
    });

    client.isUserClient = !isCentralBot;
    client.whatsappNumber = null;
    // O objeto de usuário agora é passado diretamente, garantindo que ele exista mesmo sem um socket.
    client.user = userObject;

    client.on('qr', (qr) => {
        if (isCentralBot) {
            console.log(`QR Code para BOT CENTRAL:`);
            qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
                if (err) console.error(`Erro ao gerar QR Code para BOT CENTRAL:`, err);
                console.log(url);
            });
        } else if (socket) {
            // Só emite QR Code para o frontend se houver um socket conectado (ou seja, um usuário na página)
            console.log(`QR Code gerado para ${sanitizedIdentifier}`);
            socket.emit('log', 'QR Code gerado. Por favor, escaneie para conectar.');
            qrcode.toDataURL(qr, (err, url) => {
                if (err) {
                    console.error(`Erro ao gerar QR Code para ${sanitizedIdentifier}:`, err);
                    return socket.emit('error', 'Erro ao gerar QR Code.');
                }
                socket.emit('qr', url);
            });
        }
    });

    client.on('ready', async () => {
        const whatsappNumber = client.info.wid.user;
        client.whatsappNumber = whatsappNumber;

        console.log(`Cliente ${sanitizedIdentifier} conectado! Número do WhatsApp: ${whatsappNumber}`);
        if (socket) {
            socket.emit('ready');
            socket.emit('log', `Conectado com sucesso com o número: ${whatsappNumber}`);
        }

        try {
            if (isCentralBot) {
                centralBotWhatsappNumber = whatsappNumber;
                console.log(`BOT CENTRAL conectado com o número: ${centralBotWhatsappNumber}`);
            } else {
                console.log(`[WhatsApp Service] Cliente de usuário '${sanitizedIdentifier}' conectado. Verificando associação de número.`);
                // A verificação usa 'client.user.id' pois o objeto vem direto do DB na inicialização.
                if (client.user && (client.user.id || client.user.userId)) {
                    const userId = client.user.id || client.user.userId;
                    console.log(`[WhatsApp Service] Usuário (ID: ${userId}, Username: ${client.user.username}) encontrado. Tentando atualizar o número...`);
                    
                    dbService.updateUserWhatsappNumber(userId, whatsappNumber);
                    
                    client.user.command_whatsapp_number = whatsappNumber;
                    client.user.clientId = whatsappNumber;
                    
                    console.log(`[WhatsApp Service] SUCESSO: Associação no DB para ${client.user.username} concluída. Número salvo: ${whatsappNumber}`);
                } else {
                    console.error(`[WhatsApp Service] ERRO CRÍTICO: Cliente '${sanitizedIdentifier}' conectado, mas o objeto 'client.user' está faltando ou incompleto.`);
                    console.error('[WhatsApp Service] O número do WhatsApp NÃO será salvo no banco de dados. Detalhes do client.user:', client.user);
                    if(socket) {
                        socket.emit('error', 'Conectado ao WhatsApp, mas falha ao associar o número à sua conta. Por favor, tente fazer login novamente.');
                    }
                }
            }

            dbService.getUserDb(whatsappNumber);
            console.log(`Estrutura de dados garantida para o cliente: ${whatsappNumber}`);

            if (socket) {
                socket.emit('log', 'Configuração inicial concluída. O sistema está pronto.');
            }

        } catch (error) {
            console.error(`Erro ao configurar o cliente ${sanitizedIdentifier} após a conexão:`, error);
            if (socket) {
                socket.emit('error', 'Ocorreu um erro ao salvar a configuração do seu número.');
            }
        }
    });

    client.on('disconnected', async (reason) => {
        console.log(`Cliente ${sanitizedIdentifier} desconectado:`, reason);
        if (clients[sanitizedIdentifier]) {
            try {
                await clients[sanitizedIdentifier].destroy();
                console.log(`Cliente ${sanitizedIdentifier} destruído com sucesso.`);
            } catch (e) {
                console.error(`Erro ao destruir o cliente ${sanitizedIdentifier}:`, e);
            }
            delete clients[sanitizedIdentifier];
        }
        if (isCentralBot) {
            centralBotWhatsappNumber = null;
        }
        if (socket) {
            socket.emit('disconnected');
            socket.emit('log', `Desconectado. Por favor, atualize a página.`);
        }
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
         const userMessage = message.body;
    const userId = message.from; // ID único do usuário

    // --- Rota para o Chatbot ---
    // Responde se a mensagem começar com '!ia'
    if (userMessage.toLowerCase().startsWith('!ia ')) {
        const prompt = userMessage.substring(4); // Pega o texto após '!ia '
        
        message.reply('🤖 Pensando...'); // Feedback para o usuário

        const aiResponse = await geminiChatService.sendMessageToAI(userId, prompt);
        message.reply(aiResponse);
        return;
    }

    // --- Rota para Análise de Imagem ---
    // Responde se o usuário enviar uma imagem com uma legenda começando com '!analisar'
    if (message.hasMedia && message.body.toLowerCase().startsWith('!analisar ')) {
        const prompt = message.body.substring(10); // Pega o texto após '!analisar '
        
        message.reply('🖼️ Analisando a imagem...');

        try {
            const media = await message.downloadMedia();
            if (media && media.mimetype.startsWith('image/')) {
                // Salva a imagem temporariamente
                const filePath = `./temp_media.${media.mimetype.split('/')[1]}`;
                fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

                // Chama o serviço de análise
                const analysisResult = await geminiFileService.analyzeFile(prompt, filePath, media.mimetype);
                message.reply(analysisResult);

                // Apaga o arquivo temporário
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
        const commandService = require('./commandService');
        if (!isCentralBot) {
            return;
        }
        if (!message.from.includes('@c.us')) return;

        try {
            const senderNumber = message.from.replace('@c.us', '');
            console.log(`[Central Bot] Mensagem recebida de ${senderNumber}: ${message.body}`);

            let user = null;
            for (const key in clients) {
                const c = clients[key];
                if (c.isUserClient && c.whatsappNumber === senderNumber) {
                    user = c.user;
                    console.log(`[Central Bot] Usuário encontrado na sessão ativa: ${user.username}`);
                    break;
                }
            }

            if (!user) {
                console.log(`[Central Bot] Usuário não encontrado na sessão ativa. Consultando banco de dados...`);
                user = dbService.findUserByWhatsappNumber(senderNumber);
            }

            if (!user) {
                if (message.body.startsWith('.') || message.body.startsWith('!')) {
                    console.log(`[Central Bot] Comando de número desconhecido ${senderNumber}. Respondendo e ignorando.`);
                    return message.reply('❌ Seu número de WhatsApp não está associado a uma conta. Por favor, faça login no painel web primeiro para registrar seu número.');
                }
                console.log(`[Central Bot] Ignorando mensagem de número desconhecido ${senderNumber}.`);
                return;
            }

            console.log(`[Central Bot] Processando comando para o usuário: ${user.username}`);
            dbService.getUserDb(senderNumber);
            const userSanitizedIdentifier = sanitizeIdentifier(user.username);
            const userSocket = clients[userSanitizedIdentifier]?.socket || null;
            await commandService.handleCommand(message, user, senderNumber, userSocket, getCentralBotWhatsappNumber());

        } catch (error) {
            console.error('[Central Bot] Erro no manipulador de mensagens:', error);
            await message.reply('❌ Ocorreu um erro interno ao processar seu comando.');
        }
    });

    client.initialize().catch(err => {
        console.error(`Falha ao inicializar cliente para ${sanitizedIdentifier}:`, err);
        if (socket) {
            socket.emit('error', 'Falha ao inicializar a sessão do WhatsApp.');
        }
    });

    client.socket = socket;
    clients[sanitizedIdentifier] = client;
    console.log(`Cliente para ${sanitizedIdentifier} adicionado à lista de clientes ativos.`);
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
