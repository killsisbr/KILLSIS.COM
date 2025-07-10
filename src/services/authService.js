    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const db = require('./databaseService');

    // É crucial que este segredo seja uma variável de ambiente e não esteja hardcoded em produção.
    // Por exemplo: process.env.JWT_SECRET
    const JWT_SECRET = process.env.JWT_SECRET || 'seu-segredo-super-secreto-para-jwt-troque-isso'; 

    // Handlers para as rotas do Express

    /**
     * Manipulador para a rota de registo de utilizadores.
     * Cria um novo utilizador no sistema.
     * @param {object} req - Objeto de requisição do Express.
     * @param {object} res - Objeto de resposta do Express.
     */
    async function registerHandler(req, res) {
        try {
            const { username, password } = req.body; // ALTERADO: Removido commandWhatsappNumber do body

            // Validação básica de entrada: apenas username e password são obrigatórios no registo inicial
            if (!username || !password) {
                return res.status(400).json({ message: 'Nome de utilizador e senha são obrigatórios.' });
            }

            // Verifica se o nome de utilizador já existe
            const existingUserByUsername = db.findUserByUsername(username);
            if (existingUserByUsername) {
                return res.status(409).json({ message: 'Nome de utilizador já existe.' });
            }

            // Não há validação de commandWhatsappNumber aqui, pois ele não é fornecido no registo inicial
            // e será definido como NULL no DB.

            // Gera o hash da senha
            const passwordHash = await bcrypt.hash(password, 10);
            
            // Cria o utilizador na base de dados. client_id e command_whatsapp_number serão NULL.
            const userId = db.createUser(username, passwordHash); // ALTERADO: Não passa commandWhatsappNumber
            
            res.status(201).json({ 
                message: 'Utilizador criado com sucesso!', 
                userId 
            }); // ALTERADO: Não retorna clientId aqui, pois ele é NULL
        } catch (error) {
            console.error("Erro no registo:", error);
            // Mensagem de erro genérica para evitar vazar detalhes internos
            res.status(500).json({ message: 'Erro interno do servidor ao registar.' });
        }
    }

    /**
     * Manipulador para a rota de login de utilizadores.
     * Autentica o utilizador e retorna um token JWT.
     * @param {object} req - Objeto de requisição do Express.
     * @param {object} res - Objeto de resposta do Express.
     */
    async function loginHandler(req, res) {
        try {
            const { username, password } = req.body;

            // Validação básica de entrada
            if (!username || !password) {
                return res.status(400).json({ message: 'Nome de utilizador e senha são obrigatórios.' });
            }

            // Busca o utilizador pelo nome de utilizador
            const user = db.findUserByUsername(username);
            if (!user) {
                return res.status(401).json({ message: 'Credenciais inválidas.' });
            }

            // Compara a senha fornecida com o hash armazenado
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                return res.status(401).json({ message: 'Credenciais inválidas.' });
            }

            // Gera o token JWT
            // Inclui client_id e command_whatsapp_number, que podem ser NULL
            const token = jwt.sign(
                { 
                    userId: user.id, 
                    username: user.username, 
                    clientId: user.client_id, // Pode ser NULL
                    commandWhatsappNumber: user.command_whatsapp_number // Pode ser NULL
                },
                JWT_SECRET,
                { expiresIn: '24h' } // Token expira em 24 horas
            );

            res.json({ token, clientId: user.client_id, commandWhatsappNumber: user.command_whatsapp_number }); // Retorna o token e os IDs (podem ser NULL)
        } catch (error) {
            console.error("Erro no login:", error);
            // Mensagem de erro genérica
            res.status(500).json({ message: 'Erro interno do servidor ao fazer login.' });
        }
    }

    /**
     * Middleware para verificar a validade do token JWT em rotas protegidas.
     * Anexa as informações do utilizador (decodificadas do token) a `req.user`.
     * @param {object} req - Objeto de requisição do Express.
     * @param {object} res - Objeto de resposta do Express.
     * @param {function} next - Próxima função middleware na pilha.
     */
    function verifyToken(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Extrai o token do cabeçalho "Bearer <token>"

        if (!token) {
            // Se nenhum token for fornecido, retorna 401 Unauthorized
            return res.status(401).json({ message: 'Token de autenticação não fornecido.' });
        }

        // Verifica o token usando o segredo JWT
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                // Se o token for inválido (expirado, modificado, etc.), retorna 403 Forbidden
                console.error("Erro na verificação do token:", err.message);
                return res.status(403).json({ message: 'Token inválido ou expirado.' });
            }
            // Anexa as informações do utilizador ao objeto de requisição
            req.user = user;
            next(); // Continua para a próxima função middleware
        });
    }

    module.exports = { registerHandler, loginHandler, verifyToken, JWT_SECRET };
