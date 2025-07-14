// importar-para-cliente.js

const ExcelJS = require('exceljs');
const path = require('path');
// Importe suas funções de banco de dados existentes.
// O caminho pode precisar de ajuste dependendo da estrutura de suas pastas.
const { getUserDb, closeAllConnections } = require('./databaseService'); // Assumindo que seu código está em 'database.js'

/**
 * Converte um texto de cabeçalho para um nome de coluna SQL válido.
 * Ex: "Data de Cadastro" -> "data_de_cadastro"
 * @param {string} header O texto do cabeçalho.
 * @returns {string} O nome da coluna sanitizado.
 */
function sanitizarNomeColuna(header) {
  if (!header) return null;
  return header
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_') // Substitui espaços por underscores
    .replace(/[^a-z0-9_]/g, ''); // Remove caracteres especiais, exceto underscore
}

/**
 * Orquestra a importação de uma planilha para o banco de dados de um cliente específico.
 * @param {string} clientWhatsappNumber - O número de WhatsApp que identifica o cliente.
 * @param {string} caminhoPlanilha - O caminho para o arquivo .xlsx.
 * @param {string} nomeTabela - O nome da tabela que será criada/populada.
 */
async function importarParaCliente(clientWhatsappNumber, caminhoPlanilha, nomeTabela) {
  console.log(`Iniciando importação para o cliente: ${clientWhatsappNumber}`);
  console.log(`Arquivo da planilha: ${caminhoPlanilha}`);
  console.log(`Tabela de destino: ${nomeTabela}`);

  // 1. Obter a conexão com o banco de dados do cliente específico
  const db = getUserDb(clientWhatsappNumber);

  try {
    // 2. Ler a planilha com exceljs
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(caminhoPlanilha);
    const worksheet = workbook.worksheets[0];

    if (worksheet.rowCount <= 1) {
      throw new Error('A planilha está vazia ou contém apenas o cabeçalho.');
    }

    // 3. Extrair, sanitizar e garantir a unicidade dos cabeçalhos
    const headersRaw = worksheet.getRow(1).values;
    const sanitizedHeaders = headersRaw.map(sanitizarNomeColuna).filter(h => h);
    
    const counts = {};
    const headers = sanitizedHeaders.map(header => {
        counts[header] = (counts[header] || 0) + 1;
        if (counts[header] > 1) {
            return `${header}_${counts[header]}`;
        }
        return header;
    });
    
    console.log('Cabeçalhos encontrados e únicos:', headers);


    if (headers.length === 0) {
        throw new Error('Nenhum cabeçalho válido encontrado na planilha.');
    }

    // 4. Criar a tabela dinamicamente (se não existir) usando SQL puro
    const colunasDefinicao = headers.map(h => `"${h}" TEXT`).join(', ');
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS "${nomeTabela}" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ${colunasDefinicao}
        );
    `;
    db.exec(createTableQuery);
    console.log(`Tabela "${nomeTabela}" verificada/criada com sucesso.`);

    // 5. Preparar os dados para inserção em lote
    const dadosParaInserir = [];
    worksheet.eachRow((row, rowNumber) => {
      // Pular a linha de cabeçalho
      if (rowNumber === 1) return;

      const rowData = {};
      // O .values do exceljs pode ter um primeiro elemento vazio, por isso o slice(1)
      const rowValues = Array.isArray(row.values) ? row.values.slice(1) : [];
      
      headers.forEach((header, index) => {
        // Usa o cabeçalho original (antes de adicionar sufixo) para encontrar o valor correto
        const originalHeaderSanitized = sanitizedHeaders[index];
        const cellValue = rowValues[index];

        // Converte valores para string, mantendo nulos/undefined como NULL no DB
        if (cellValue !== null && cellValue !== undefined) {
          if(typeof cellValue === 'object' && cellValue.toISOString) {
            rowData[header] = cellValue.toISOString();
          } else {
            rowData[header] = cellValue.toString();
          }
        } else {
          rowData[header] = null;
        }
      });
      
      if (Object.values(rowData).some(v => v !== null)) {
          dadosParaInserir.push(rowData);
      }
    });

    if (dadosParaInserir.length === 0) {
      console.log('Nenhum dado para importar foi encontrado após o cabeçalho.');
      return;
    }

    // 6. Inserir dados usando uma transação para alta performance (o jeito do better-sqlite3)
    console.log(`Preparando para inserir ${dadosParaInserir.length} linhas...`);
    
    const colunasInsert = headers.map(h => `"${h}"`).join(', ');
    const placeholders = headers.map(() => '?').join(', ');
    const insertStmt = db.prepare(`INSERT INTO "${nomeTabela}" (${colunasInsert}) VALUES (${placeholders})`);

    const insertMany = db.transaction((linhas) => {
      for (const linha of linhas) {
        const valoresOrdenados = headers.map(h => linha[h]);
        insertStmt.run(valoresOrdenados);
      }
    });

    insertMany(dadosParaInserir);

    console.log('Todos os dados foram importados com sucesso!');

  } catch (error) {
    console.error('Ocorreu um erro fatal durante a importação:', error);
  }
}


// --- COMO EXECUTAR O SCRIPT ---
// Você pode executar este script via linha de comando.
// Exemplo de uso: node importar-para-cliente.js 5511999998888 ./caminho/para/planilha.xlsx minha_tabela_nova

async function main() {
    // Pega os argumentos da linha de comando
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.error("Uso: node importar-para-cliente.js <clientWhatsappNumber> <caminhoPlanilha> <nomeTabela>");
        process.exit(1);
    }

    const [clientWhatsappNumber, caminhoPlanilha, nomeTabela] = args;
    const caminhoAbsoluto = path.resolve(caminhoPlanilha);

    await importarParaCliente(clientWhatsappNumber, caminhoAbsoluto, nomeTabela);

    // Fecha todas as conexões no final do script
    closeAllConnections();
}

// Verifica se o script está sendo executado diretamente
if (require.main === module) {
    main().catch(err => {
        console.error("Erro na execução principal:", err);
        closeAllConnections();
    });
}
