Whatsapp Assistant
O Whatsapp Assistant é uma plataforma robusta para automação e gestão de comunicação via WhatsApp. Combina um painel de controlo web com um bot inteligente, permitindo o disparo de campanhas, gestão de contactos e a utilização de ferramentas de Inteligência Artificial para otimizar tarefas.

<!-- Adicione aqui um screenshot ou GIF do painel de controlo -->

<!-- ![Imagem do Painel do Whatsapp Assistant] -->

✨ Funcionalidades Principais
Painel de Controlo Web: Interface central para login, conexão com o WhatsApp (QR Code), visualização de estatísticas e gestão de campanhas.

Disparo de Campanhas: Envie mensagens em massa a partir de ficheiros .xlsx, com suporte para variáveis (@nome, @cpf) e multimédia (imagens e áudio).

Gestão de Contactos: Visualize, edite e apague contactos diretamente no painel web.

Inteligência Artificial (Google Gemini):

🤖 Chatbot Assistente (Killsis): Um assistente virtual que responde a perguntas sobre o sistema.

📊 Correção de Planilhas: Analisa e corrige automaticamente planilhas de contactos desorganizadas.

🖼️ Análise e Geração de Imagens: Descreve o conteúdo de imagens e cria novas imagens a partir de texto.

Controlo Remoto por WhatsApp: Execute quase todas as funções através de comandos enviados para um bot central.

Arquitetura Segura e Isolada: Cada utilizador tem o seu próprio banco de dados e diretório de ficheiros, garantindo total privacidade.

🛠️ Tecnologias Utilizadas
Categoria

Tecnologia

Backend

Node.js, Express.js

Comunicação

Socket.IO, whatsapp-web.js

Base de Dados

better-sqlite3

IA & Machine Learning

Google Gemini API

Autenticação

JSON Web Tokens (JWT)

🚀 Instalação e Configuração
Siga estes passos para colocar o projeto a funcionar localmente.

Pré-requisitos
Node.js (versão 18.x ou superior)

NPM (instalado com o Node.js)

Uma chave de API válida do Google Gemini.

Passos de Instalação
Clone o repositório:

git clone https://github.com/seu-usuario/whatsapp-assistant.git
cd whatsapp-assistant

Instale as dependências:

npm install

Configure as variáveis de ambiente:
Crie um ficheiro chamado .env na raiz do projeto e preencha-o com as suas chaves:

# Chave de API para aceder aos modelos do Google Gemini
GEMINI_API_KEY="SUA_CHAVE_AQUI"

# Segredo para a assinatura dos tokens de autenticação (JWT)
JWT_SECRET="SEU_SEGREDO_FORTE_AQUI"

# (Opcional) Número do bot central, se desejar fixá-lo
CENTRAL_BOT_NUMBER="5500000000000"

Inicie o servidor:

npm start

O servidor estará disponível em http://localhost:3000.

📂 Estrutura do Projeto
.
├── database/                 # Armazena a base de dados de autenticação central (auth.db)
├── node_modules/             # Dependências do projeto
├── public/                   # Ficheiros do frontend (HTML, CSS, JS do painel web)
├── src/                      # Código fonte do backend
│   ├── config/               # Ficheiros de configuração (comandos, mapeamento de planilhas)
│   └── services/             # Lógica de negócio modularizada
│       ├── authService.js
│       ├── campaignService.js
│       ├── commandService.js
│       ├── databaseService.js
│       ├── gemini...Service.js # Todos os serviços relacionados com a IA
│       ├── statsService.js
│       └── whatsappService.js
├── user/                     # Diretório dinâmico para dados dos utilizadores
│   └── {numero_whatsapp}/    # Pasta isolada para cada utilizador
│       ├── database/
│       │   └── {numero_whatsapp}.db # Base de dados de contactos e campanhas
│       ├── audio.ogg
│       ├── imagem.jpeg
│       └── lista.xlsx
├── .env                      # Ficheiro para variáveis de ambiente (NÃO versionar)
├── package.json
└── server.js                 # Ponto de entrada da aplicação (servidor Express e Socket.IO)

Usage
Painel Web: Aceda a http://localhost:3000, crie uma conta e faça login. Na aba "WhatsApp", leia o QR Code com o seu telemóvel para conectar a sua conta.

Comandos via WhatsApp: Após conectar a sua conta, pode enviar comandos para o número do "Bot Central" para executar ações remotamente.

<details>
<summary><strong>Clique para ver a Lista Completa de Comandos</strong></summary>

Comando

Anexo Necessário?

Descrição

!ajuda ou Ajuda

Não

Mostra a lista completa de comandos disponíveis.

!ia <pergunta>

Não

Inicia uma conversa com o assistente virtual Killsis.

!corrigir

Planilha

A IA analisa, corrige e padroniza a planilha, devolvendo um ficheiro pronto para uso.

!analisar <pergunta>

Imagem

A IA analisa o conteúdo da imagem e responde à sua pergunta.

!gerar <quantidade>

Não

Gera e valida uma lista de contactos do WhatsApp.

!aniversariantes <hoje|mes>

Não

Cria uma planilha com os aniversariantes do período especificado.

!buscar <termo>

Não

Procura por um contacto na sua base de dados.

!texto <mensagem>

Não

Define ou atualiza o texto principal da sua campanha. Use variáveis como @nome.

.ver

Não

Pré-visualiza a mensagem da campanha, incluindo as mídias que estiverem configuradas.

.enviar <início> <fim>

Não

Inicia o envio da campanha para um intervalo de linhas da sua planilha.

.apagar <imagem|audio|lista>

Não

Apaga o ficheiro correspondente (imagem, audio, lista) da sua pasta no servidor.

(Nenhum texto de comando)

Imagem/Áudio/Planilha

Enviar um ficheiro diretamente define-o como o ficheiro padrão para a sua campanha.

</details>

🤝 Como Contribuir
As contribuições são bem-vindas! Se quiser melhorar o projeto, por favor, siga estes passos:

Faça um Fork do projeto.

Crie uma nova branch para a sua funcionalidade (git checkout -b feature/NovaFuncionalidade).

Faça commit das suas alterações (git commit -m 'Adiciona NovaFuncionalidade').

Faça push para a sua branch (git push origin feature/NovaFuncionalidade).

Abra um Pull Request.

📄 Licença
Este projeto está licenciado sob a Licença MIT. Consulte o ficheiro LICENSE para mais detalhes.