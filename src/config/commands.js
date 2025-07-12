const { MessageMedia } = require('whatsapp-web.js');
const dbService = require('../services/databaseService');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { startCampaign } = require('../services/campaignService');
const whatsappService = require('../services/whatsappService'); // Importado para usar o getClient


//texto do ajuda
let helpText = `🤖 MENU DE COMANDOS DISPONÍVEIS 🤖\n` +

    `📊--- Geração de Listas ---📊\n` +

    `📈 !gerar [n]\n` +
    `Gera uma planilha com [n] contatos válidos.\n` +
    `Ex: !gerar 15\n` +
    `🎂 !aniversariantes [hoje|mes]\n` +
    `Cria uma lista de aniversariantes. 🎉\n` +
    `Ex: !aniversariantes mes\n\n` +

    `⚙️--- Configuração da Campanha ---⚙️\n` +

    `✍️ !texto [sua mensagem]\n` +
    `Define o texto da campanha. Use @nome, @agencia, @nomecompleto. \n\n` +

    `👀 .ver\n` +
    `Pré-visualiza a mensagem da campanha, incluindo imagem ou áudio, se houver. 🖼️🎧\n\n` +

    `🚀--- Execução e Gerenciamento ---🚀\n` +

    `📩 .enviar [início] [fim]\n` +
    `Inicia o envio da campanha para um intervalo de linhas da sua planilha.\n` +
    `Ex: .enviar 2 100\n\n` +

    `🔍 !buscar [termo]\n` +
    `Busca um contato na sua base de dados. 👤\n` +
    `Ex: 🔍 Use essa lupa no chat do cliente.\n` +

    `🗑️ apagar [tipo]\n` +
    `Apaga um arquivo da sua pasta. ❌\n` +
    `Ex: apagar imagem, apagar audio, apagar lista\n\n` +

    `📁--- Arquivos ---📁\n` +

    `Para usar uma planilha 📊, imagem 🖼️ ou áudio 🎧, basta enviar o arquivo diretamente para mim. 👉🤖`;


// --- LOG DE DEPURAÇÃO ---
console.log('✅ [Commands] Módulos carregados: dbService, fs, path, XLSX, campaignService, whatsappService.');


// --- Funções Auxiliares para o Comando !gerar ---

function generateRandomBrazilianPhoneNumber() {
    const ddds = ['41', '42', '43', '44', '45'];
    const randomDdd = ddds[Math.floor(Math.random() * ddds.length)];
    let number = '9'; // Garante que comece com 9
    for (let i = 0; i < 7; i++) { // 7 dígitos restantes para um total de 8
        number += Math.floor(Math.random() * 10);
    }
    return `${randomDdd}${number}`;
}

function generateRandomBirthday() {
    const start = new Date(1950, 0, 1);
    const end = new Date(2005, 11, 31);
    const randomDate = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    const day = String(randomDate.getDate()).padStart(2, '0');
    const month = String(randomDate.getMonth() + 1).padStart(2, '0');
    const year = randomDate.getFullYear();
    return `${day}/${month}/${year}`;
}

// --- Definição dos Comandos ---

const commands = [
    {
        command: '!register',
        description: 'Inicia a configuração do cliente.',
        action: async (message) => {
            const contact = await message.getContact();
            await message.reply(`Olá, ${contact.pushname}! vamos configurar?`);
        }
    },
    {
        command: 'Ajuda',
        description: 'Inicia a configuração do cliente.',
        action: async (message) => {
            const contact = await message.getContact();
            await message.reply(`Olá, ${contact.pushname}!\n${helpText}`);
        }
    },
    {
        command: '!ajuda',
        description: 'Mostra a lista de comandos disponíveis.',
        action: async (message) => {
            await message.reply(helpText);
        }
    },
    {
        command: '!gerar',
        description: 'Gera uma lista de contatos válidos do WhatsApp. Uso: `!gerar [quantidade]`',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase) => {
            const getClient = whatsappService.getClient;
            const parts = message.body.split(' ');
            const quantidade = parseInt(parts[1]);

            if (isNaN(quantidade) || quantidade <= 0 || quantidade > 50) {
                return message.reply('❌ Quantidade inválida. Por favor, especifique um número entre 1 e 50. Ex: `!gerar 10`');
            }

            const client = getClient(user.username);
            if (!client) {
                return message.reply('❌ Seu cliente WhatsApp não está inicializado. Por favor, conecte-se primeiro.');
            }
            const state = await client.getState();
            if (state !== 'CONNECTED') {
                return message.reply('❌ Seu cliente WhatsApp não está conectado. Por favor, vá para a aba WhatsApp e escaneie o QR Code.');
            }

            await message.reply(`⏳ Gerando e validando ${quantidade} contatos de WhatsApp. Isso pode levar alguns minutos...`);

            let generatedAttempts = 0, validCount = 0;
            const validContactsForExcel = [];

            while (validCount < quantidade && generatedAttempts < (quantidade * 10)) {
                generatedAttempts++;
                const randomPhoneNumber = generateRandomBrazilianPhoneNumber();
                const fullWhatsappNumber = `55${randomPhoneNumber}@c.us`;

                try {
                    if (await client.isRegisteredUser(fullWhatsappNumber)) {
                        validCount++;
                        const ddd = randomPhoneNumber.substring(0, 2);
                        const tel = randomPhoneNumber.substring(2);
                        validContactsForExcel.push({
                            'Nome': ``, 'CPF': `00000`,
                            'Agencia': 'N/A', 'Nascimento': generateRandomBirthday(), 'DDD_01': ddd, 'TEL_01': tel
                        });
                        if (socket) socket.emit('log', `✅ Válido: ${fullWhatsappNumber.replace('@c.us', '')} (${validCount}/${quantidade})`);
                    } else {
                        if (socket) socket.emit('log', `⭕ Inválido: ${fullWhatsappNumber.replace('@c.us', '')}`);
                    }
                } catch (error) {
                    if (socket) socket.emit('log', `❌ Erro ao validar ${fullWhatsappNumber.replace('@c.us', '')}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
            }

            if (validContactsForExcel.length > 0) {
                const outputFileName = `lista_gerada.xlsx`; // Nome de arquivo fixo
                const outputPath = path.join(userDirBase, clientId, outputFileName);

                const ws = XLSX.utils.json_to_sheet(validContactsForExcel);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Contatos Gerados');
                XLSX.writeFile(wb, outputPath);
                const media = MessageMedia.fromFilePath(outputPath);
                await message.reply(media, undefined, { caption: `📊 Planilha gerada ${validContactsForExcel.length} contatos válidos!` });
            }

            const summaryMessage = `🎉 Geração Finalizada!\n\nTentativas: ${generatedAttempts}\nContatos Válidos: ${validCount}`;
            await message.reply(summaryMessage);
            if (socket) socket.emit('log', summaryMessage);
        }
    },
    {
        command: '!aniversariantes',
        description: 'Gera uma lista de aniversariantes. Uso: `!aniversariantes [hoje|mes]`',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase) => {
            const parts = message.body.split(' ');
            const filterType = parts[1]?.toLowerCase();

            if (filterType !== 'hoje' && filterType !== 'mes') {
                return message.reply('❌ Formato inválido. Use `!aniversariantes hoje` ou `!aniversariantes mes`.');
            }

            try {
                const dbFilter = filterType === 'hoje' ? 'aniversariantesHoje' : 'aniversariantesMes';
                const contacts = dbService.getFilteredContacts(clientId, dbFilter);

                if (!contacts || contacts.length === 0) {
                    return message.reply(`🤷 Nenhum aniversariante encontrado para ${filterType === 'hoje' ? 'hoje' : 'este mês'}.`);
                }

                const outputFileName = `aniversariantes_${filterType}.xlsx`; // Nome de arquivo fixo
                const outputPath = path.join(userDirBase, clientId, outputFileName);

                await message.reply(`📊 Gerando planilha \`${outputFileName}\` com ${contacts.length} aniversariante(s)...`);

                const ws = XLSX.utils.json_to_sheet(contacts);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, `Aniversariantes ${filterType}`);
                XLSX.writeFile(wb, outputPath);

                const media = MessageMedia.fromFilePath(outputPath);
                await message.reply(media, undefined, { caption: `🎉 Planilha com ${contacts.length} aniversariante(s) de ${filterType === 'hoje' ? 'hoje' : 'do mês'}!` });
            } catch (error) {
                console.error(`Erro no comando !aniversariantes para ${clientId}:`, error);
                await message.reply('❌ Ocorreu um erro ao gerar a lista de aniversariantes.');
            }
        }
    },
    {
        command: '!buscar',
        description: 'Busca um cliente por CPF, nome ou telefone. \nUso: `!buscar [termo]`',
        action: async (message, user, clientId) => {
            const searchTerm = message.body.replace('!buscar', '').trim();
            if (!searchTerm) {
                return message.reply('Por favor, informe um CPF, nome ou telefone para buscar.\n\n*Exemplo:* `!buscar 123.456.789-00`');
            }
            try {
                const contacts = dbService.getFilteredContacts(clientId, 'default', searchTerm);
                if (contacts && contacts.length > 0) {
                    let replyMsg = `*✅ Cliente(s) Encontrado(s)*\n\n`;
                    contacts.forEach(contact => {
                        replyMsg += `*Nome:* ${contact.nome || 'N/A'}\n*CPF:* ${contact.cpf || 'N/A'}\n*Telefone:* ${contact.telefone || 'N/A'}\n*Nascimento:* ${contact.nascimento || 'N/A'}\n*Agência:* ${contact.agencia || 'N/A'}\n*Último Contato:* ${contact.data_envio_ultima_mensagem ? new Date(contact.data_envio_ultima_mensagem).toLocaleDateString() : 'Nenhum'}\n\n`;
                    });
                    await message.reply(replyMsg);
                } else {
                    await message.reply(`*❌ Nenhum cliente encontrado com o termo:* "${searchTerm}"`);
                }
            } catch (error) {
                console.error("Erro ao buscar contato:", error);
                await message.reply('Ocorreu um erro ao buscar o contato no banco de dados.');
            }
        }
    },
    {
        command: '!texto',
        description: 'Define o texto da mensagem de disparo. Uso: `!texto [sua mensagem]`',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase, atualizarTexto) => {
            const texto = message.body.slice('!texto'.length).trim();
            if (!texto) {
                return message.reply('❌ Você precisa fornecer um texto para a mensagem.');
            }
            atualizarTexto(clientId, texto, message);
        },
    },
    {
        command: '.enviar',
        description: 'Inicia o envio da lista de contatos. Uso: `.enviar [inicio] [fim]`',
        action: async (message, user, clientId, socket) => {
            const parts = message.body.split(' ');
            const inicio = parseInt(parts[1]);
            const fim = parseInt(parts[2]);

            if (isNaN(inicio) || isNaN(fim) || inicio <= 1 || inicio > fim) {
                return message.reply('Formato inválido. Use: `.enviar [linha_inicial] [linha_final]`. Ex: `.enviar 2 100` (a linha 1 é o cabeçalho).');
            }

            const listFileName = 'lista.xlsx';
            const userDir = path.join(__dirname, '..', '..', 'user');
            const messageFilePath = path.join(userDir, clientId, 'mensagem.json');

            if (!fs.existsSync(messageFilePath)) {
                return message.reply('❌ Por favor, defina a mensagem de disparo primeiro usando `!texto [sua mensagem]`');
            }

            let messageContent;
            try {
                messageContent = JSON.parse(fs.readFileSync(messageFilePath, 'utf8'));
            } catch (error) {
                return message.reply('❌ Erro ao ler a mensagem de disparo.');
            }

            const campaignOptions = {
                campaignId: clientId, username: user.username,
                start: inicio - 1, end: fim - 1, // Corrigido
                message: messageContent
                , listFileName: listFileName, useAI: false
            };
            console.log(`[Comando .enviar] Iniciando campanha com as seguintes opções:`, campaignOptions);
            startCampaign(campaignOptions, { socket, commandMessage: message });
        }
    },
    {
        command: '.ver',
        description: 'Mostra o texto e a mídia da campanha atual.',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase) => {
            const messageFilePath = path.join(userDirBase, clientId, 'mensagem.json');
            if (!fs.existsSync(messageFilePath)) {
                return message.reply('Nenhuma mensagem de disparo definida. Use `!texto [sua mensagem]` para definir.');
            }
            try {
                const messageContent = JSON.parse(fs.readFileSync(messageFilePath, 'utf8'));
                const fullMessage = `*Sua mensagem de campanha atual:*\n\n${messageContent}`;

                let imagePath = '';
                const imageExtensions = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
                for (const ext of imageExtensions) {
                    const tempPath = path.join(userDirBase, clientId, `imagem.${ext}`);
                    if (fs.existsSync(tempPath)) {
                        imagePath = tempPath;
                        break;
                    }
                }

                const audioPath = path.join(userDirBase, clientId, 'audio.ogg');
                const audioExists = fs.existsSync(audioPath);

                if (imagePath) {
                    const media = MessageMedia.fromFilePath(imagePath);
                    await message.reply(media, undefined, { caption: fullMessage });
                } else {
                    await message.reply(fullMessage);
                }
                if (audioExists) {

                    const media = MessageMedia.fromFilePath(audioPath);
                    await message.reply(media);
                }
            } catch (error) {
                console.error(`Erro no comando .ver para ${clientId}:`, error);
                message.reply('❌ Erro ao ler a mensagem de disparo.');
            }
        }
    },
    {
        command: 'Apagar',
        description: 'Apaga mídia (audio/imagem) ou lista. Uso: `.del [audio|imagem|lista]`',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase) => {
            const mediaType = message.body.replace('Apagar ', '').trim().toLowerCase();
            let filePathToDelete = '';
            let replyMessage = '';

            if (mediaType === 'audio') {
                filePathToDelete = path.join(userDirBase, clientId, 'audio.ogg');
                replyMessage = '✅ Áudio Apagado com Sucesso!';
            } else if (mediaType === 'imagem') {
                const imageExtensions = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
                for (const ext of imageExtensions) {
                    const tempPath = path.join(userDirBase, clientId, `imagem.${ext}`);
                    if (fs.existsSync(tempPath)) {
                        filePathToDelete = tempPath;
                        replyMessage = `✅ Imagem .${ext} Apagada!`;
                        break;
                    }
                }
                if (!filePathToDelete) return message.reply('❌ Você não tem imagem salva!');
            } else if (mediaType === 'foto') {
                const imageExtensions = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
                for (const ext of imageExtensions) {
                    const tempPath = path.join(userDirBase, clientId, `imagem.${ext}`);
                    if (fs.existsSync(tempPath)) {
                        filePathToDelete = tempPath;
                        replyMessage = `✅ Imagem .${ext} Apagada!`;
                        break;
                    }
                }
                if (!filePathToDelete) return message.reply('❌ Você não tem imagem salva!');
            } else if (mediaType === 'lista') {
                filePathToDelete = path.join(userDirBase, clientId, 'lista.xlsx');
                replyMessage = '✅ Planilha Apagada com Sucesso!';
            } else {
                return message.reply('Comando inválido. Use: `.del [audio|imagem|lista]`');
            }

            if (fs.existsSync(filePathToDelete)) {
                fs.unlink(filePathToDelete, err => {
                    if (err) message.reply(`❌ Erro ao apagar ${mediaType}.`);
                    else message.reply(replyMessage);
                });
            } else {
                return message.reply(`❌ Não há ${mediaType} para apagar!`);
            }
        }
    }
];


module.exports = commands;
