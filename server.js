// server.js

// --- Módulos ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// --- Serviços Internos ---
const authService = require('./src/services/authService');
const statsService = require('./src/services/statsService.js');
const whatsAppService = require('./src/services/whatsappService');
const campaignService = require('./src/services/campaignService');
const dbService = require('./src/services/databaseService');

// --- Configuração ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000;

// --- Middlewares ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// --- Diretórios ---
const userDir = path.join(__dirname, 'user');
if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir);
}

// --- Rota Principal e de Login ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// --- Rotas da API de Autenticação ---
app.post('/api/register', authService.registerHandler);
app.post('/api/login', authService.loginHandler);


// --- Rotas Protegidas da API ---
app.get('/api/user/me', authService.verifyToken, (req, res) => res.json(req.user));
app.get('/api/stats', authService.verifyToken, statsService.getStatsHandler);

app.get('/api/contacts', authService.verifyToken, (req, res) => {
    try {
        const clientId = req.user.clientId;
        const { filter, search } = req.query;

        // ✅ VERIFICAÇÃO ADICIONADA AQUI
        if (!clientId) {
            // Se o usuário não tem um clientId (WhatsApp não conectado),
            // retorna uma lista vazia em vez de quebrar o servidor.
            console.log(`Usuário '${req.user.username}' tentou acessar contatos sem um clientId. Retornando lista vazia.`);
            return res.json([]); // Retorna um array vazio
        }

        const contacts = dbService.getFilteredContacts(clientId, filter, search);
        res.json(contacts);
    } catch (error) {
        console.error("Erro na rota /api/contacts:", error);
        res.status(500).json({ message: 'Erro ao buscar contatos.' });
    }
});


// --- Lógica do Socket.IO com Autenticação ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error("Token de autenticação não fornecido."));
    }
    jwt.verify(token, authService.JWT_SECRET, (err, user) => {
        if (err) return next(new Error("Token inválido."));
        socket.user = user;
        next();
    });
}).on('connection', (socket) => {
    console.log(`[+] Cliente autenticado e conectado: ${socket.user.username} (ClientID: ${socket.user.clientId})`);

    // Inicializa o cliente WhatsApp para o usuário logado
    // A assinatura da função foi atualizada para (sessionIdentifier, userObject, socket, isCentralBot)
    whatsAppService.initializeClient(socket.user.username, socket.user, socket, false);

    socket.on('upload-list', ({ id, file, fileName }) => {
        console.log(`[+] Recebido upload de lista do usuário '${socket.user.username}'. Ficheiro: ${fileName}`);
        const clientUserDir = path.join(userDir, id);
        if (!fs.existsSync(clientUserDir)) fs.mkdirSync(clientUserDir);
        const filePath = path.join(clientUserDir, fileName);
        fs.writeFile(filePath, Buffer.from(file), (err) => {
            if (err) {
                console.error(`   - Erro ao guardar a lista para ${socket.user.username}: ${err.message}`);
                return socket.emit('log', `Erro ao guardar a lista: ${err.message}`);
            }
            console.log(`   - Lista '${fileName}' guardada com sucesso para o cliente ${id}.`);
            socket.emit('upload-success', { fileName });
        });
    });

    socket.on('upload-media', ({ id, file, type }) => {
        const mediaFileName = type.startsWith('image/') ? 'imagem.jpeg' : 'audio.ogg';
        console.log(`[+] Recebido upload de multimédia do usuário '${socket.user.username}'. Ficheiro: ${mediaFileName}`);
        const clientUserDir = path.join(userDir, id);
        if (!fs.existsSync(clientUserDir)) fs.mkdirSync(clientUserDir);
        const filePath = path.join(clientUserDir, mediaFileName);
        fs.writeFile(filePath, Buffer.from(file), (err) => {
            if (err) {
                console.error(`   - Erro ao guardar a multimédia para ${socket.user.username}: ${err.message}`);
                return socket.emit('log', `Erro ao guardar a mídia: ${err.message}`);
            }
            console.log(`   - Multimédia '${mediaFileName}' guardada com sucesso para o cliente ${id}.`);
            socket.emit('upload-success', { fileName: mediaFileName });
        });
    });

    socket.on('start-sending', async (data) => {
        console.log(`[+] Campanha iniciada pelo usuário '${socket.user.username}' com os seguintes dados:`);
        console.log(`    - ID do Cliente: ${data.id}`);
        console.log(`    - Ficheiro da Lista: ${data.listFileName}`);
        console.log(`    - Início do Índice: ${data.start}`);
        console.log(`    - Fim do Índice: ${data.end}`);
        console.log(`    - Mensagem: "${data.message.substring(0, 50)}..."`);
        campaignService.startCampaign(data, { socket }); // Passa o socket como um objeto para manter a compatibilidade
    });
});

/**
 * Inicializa automaticamente as sessões de WhatsApp para todos os usuários
 * que já têm um número associado no banco de dados.
 */
function initializeUserSessionsOnStartup() {
    console.log('\n[+] Verificando sessões de usuário para inicialização automática...');
    try {
        const allUsers = dbService.getAllUsers();
        for (const user of allUsers) {
            // Inicia a sessão apenas para usuários que já vincularam um número de WhatsApp
            if (user.command_whatsapp_number) {
                console.log(`   -> Iniciando sessão em background para: ${user.username} (Número: ${user.command_whatsapp_number})`);
                // Chama initializeClient sem um socket, mas com o objeto de usuário completo.
                whatsAppService.initializeClient(user.username, user, null, false);
            }
        }
        console.log('[+] Verificação de sessões concluída.');
    } catch (error) {
        console.error('[-] Erro crítico ao inicializar sessões de usuário na inicialização:', error);
    }
}


// --- Iniciar Servidor ---
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);

    // 1. Inicializa o bot central na inicialização do servidor
    whatsAppService.initializeClient('bot-central', null, null, true);

    // 2. Inicializa as sessões de todos os usuários já registrados
    initializeUserSessionsOnStartup();

    // 3. Bloco para imprimir o estado do banco de dados na inicialização
    console.log("\n--- CONTEÚDO ATUAL DO BANCO DE DADOS ---");
    try {
        const allUsers = dbService.getAllUsers();
        if (allUsers.length === 0) {
            console.log("Nenhum usuário registrado no momento.");
        } else {
            allUsers.forEach(user => {
                console.log(`[+] Usuário: ${user.username} (ID: ${user.id}, ClientID: ${user.client_id})`);
                if (!user.client_id) {
                    console.log("    - Nenhum número de WhatsApp associado. Contatos não podem ser carregados.");
                }
            });
        }
    } catch (dbError) {
        console.error("Erro ao imprimir o estado do banco de dados:", dbError);
    }
    console.log("------------------------------------------\n");
});
