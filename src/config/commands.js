const { MessageMedia } = require('whatsapp-web.js');
const dbService = require('../services/databaseService');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { startCampaign } = require('../services/campaignService');

// --- LOG DE DEPURAÇÃO ---
console.log('✅ [Commands] Módulos carregados: dbService, fs, path, XLSX, campaignService.');

// Assinatura de Ação Padrão (para referência):
// async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase, atualizarTexto, startCampaign, dbService, XLSX)

const commands = [
    {
        command: '👋',
        description: 'Envia uma saudação de volta.',
        action: async (message) => {
            const contact = await message.getContact();
            await message.reply(`Olá, ${contact.pushname}! Como posso ajudar? 👋`);
        }
    },
    {
        command: '!ajuda',
        description: 'Mostra a lista de comandos disponíveis.',
        action: async (message) => {
            let helpText = `*COMANDOS DISPONIVEIS*\n\n` +
                `Defina seu texto usando:\n` +
                `*!texto* (sua mensagem)\n` +
                `Use @nome, @nomecompleto, @agencia\n\n` +
                `_Lista, fotos e áudio, apenas me envie._\n` +
                `Apagar use *.del (imagem/audio/lista)*\n\n` +
                `Iniciar envio da lista.\n` +
                `*.envio (inicio) (fim)*\n\n` +
                `Receber retorno\n` +
                `*.retorno* (nome da campanha)\n\n` +
                `*!buscar* (cpf/ou dados) (veja como ficou sua mensagem).\n`;
            await message.reply(helpText);
        }
    },
    {
        command: '!buscar',
        description: 'Busca um cliente por CPF, nome ou telefone. \nUso: `!buscar [termo]`',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase, atualizarTexto, startCampaign, dbService, XLSX) => {
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
        command: '.envio',
        description: 'Inicia o envio da lista de contatos. Uso: `.envio [inicio] [fim]`',
        action: async (message, user, clientId, socket, userDirBase, startCampaign) => {
            const parts = message.body.split(' ');
            const inicio = parseInt(parts[1]);
            const fim = parseInt(parts[2]);

            if (isNaN(inicio) || isNaN(fim) || inicio <= 0 || fim <= 0 || inicio > fim) {
                return message.reply('Formato inválido. Use: `.envio [linha_inicial] [linha_final]`. Ex: `.envio 2 100`');
            }

            const listFileName = 'lista.xlsx';
            const messageFilePath = path.join(userDirBase, clientId, 'mensagem.json');

            if (!fs.existsSync(messageFilePath)) {
                return message.reply('❌ Por favor, defina a mensagem de disparo primeiro usando `!texto [sua mensagem]`');
            }

            let messageContent;
            try {
                messageContent = JSON.parse(fs.readFileSync(messageFilePath, 'utf8'));
            } catch (error) {
                return message.reply('❌ Erro ao ler a mensagem de disparo. Verifique o formato do arquivo.');
            }
            
            // --- LOG DE DEPURAÇÃO ---
            console.log(`[Comando .envio] Iniciando campanha para user: ${user.username} de ${inicio} a ${fim}`);

            startCampaign({
                id: user.username,
                start: inicio -1,
                end: fim -1,
                message: messageContent,
                listFileName: listFileName,
                useAI: false
            }, { socket, commandMessage: message });
        }
    },
    {
        command: '.enviar',
        description: 'Inicia o envio da lista de contatos. Uso: `.enviar [inicio] [fim]`',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase, atualizarTexto, startCampaign, dbService, XLSX) => {
            const parts = message.body.split(' ');
            const inicio = parseInt(parts[1]);
            const fim = parseInt(parts[2]);

            if (isNaN(inicio) || isNaN(fim) || inicio <= 0 || fim <= 0 || inicio > fim) {
                return message.reply('Formato inválido. Use: `.enviar [linha_inicial] [linha_final]`. Ex: `.enviar 2 100`');
            }

            const listFileName = 'lista.xlsx';
            const messageFilePath = path.join(userDirBase, clientId, 'mensagem.json');

            if (!fs.existsSync(messageFilePath)) {
                return message.reply('❌ Por favor, defina a mensagem de disparo primeiro usando `!texto [sua mensagem]`');
            }

            let messageContent;
            try {
                messageContent = JSON.parse(fs.readFileSync(messageFilePath, 'utf8'));
            } catch (error) {
                return message.reply('❌ Erro ao ler a mensagem de disparo. Verifique o formato do arquivo.');
            }

            const campaignOptions = {
                campaignId: clientId, // Este é o número de telefone do remetente
                username: user.username,
                start: inicio - 1,
                end: fim - 1,
                message: messageContent,
                listFileName: listFileName,
                useAI: false
            };

            // --- LOG DE DEPURAÇÃO ---
            console.log(`[Comando .enviar] Iniciando campanha com as seguintes opções:`);
            console.log(campaignOptions);

            startCampaign(campaignOptions, { socket, commandMessage: message });
        }
    },
    {
        command: '.ver',
        description: 'Mostra o texto da mensagem de disparo atual.',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase) => {
            const messageFilePath = path.join(userDirBase, clientId, 'mensagem.json');
            if (!fs.existsSync(messageFilePath)) {
                return message.reply('Nenhuma mensagem de disparo definida. Use `!texto [sua mensagem]` para definir.');
            }
            try {
                const messageContent = JSON.parse(fs.readFileSync(messageFilePath, 'utf8'));
                message.reply(`*Sua mensagem atual:*\n\n${messageContent}`);
            } catch (error) {
                message.reply('❌ Erro ao ler a mensagem de disparo. O arquivo pode estar corrompido.');
            }
        }
    },
    {
        command: '.del',
        description: 'Apaga mídia (audio/imagem) ou lista. Uso: `.del [audio|imagem|lista]`',
        action: async (message, user, clientId, socket, centralBotWhatsappNumber, userDirBase) => {
            const mediaType = message.body.replace('.del ', '').trim().toLowerCase();
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
            } else if (mediaType === 'lista') {
                filePathToDelete = path.join(userDirBase, clientId, 'lista.xlsx');
                replyMessage = '✅ Planilha Apagada com Sucesso!';
            } else {
                return message.reply('Comando inválido. Use: `.del [audio|imagem|lista]`');
            }

            fs.access(filePathToDelete, fs.constants.F_OK, (err) => {
                if (err) return message.reply(`❌ Não há ${mediaType} para apagar!`);

                fs.unlink(filePathToDelete, err => {
                    if (err) message.reply(`❌ Erro ao apagar ${mediaType}.`);
                    else message.reply(replyMessage);
                });
            });
        }
    }
];

module.exports = commands;
