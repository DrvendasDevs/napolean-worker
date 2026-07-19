/**
 * Mensagens automáticas fixas do canal WhatsApp.
 * Estes textos NÃO são gerados por IA. São editáveis pelo master e persistidos
 * globalmente; estes valores são apenas o fallback padrão.
 */
export const DEFAULT_TEMPLATES = {
    text_received: 'Este canal é exclusivo para processamento de avaliações comerciais.\n\n' +
        'Envie um dos seguintes arquivos:\n• Áudio da ligação\n• PDF, TXT, MD ou DOCX com a transcrição\n\n' +
        'Mensagens de texto livres não são processadas (exceto a escolha do colaborador, quando solicitada).',
    unsupported_file: 'O formato enviado não é aceito para avaliação.\n\n' +
        'Envie um arquivo de áudio da ligação ou um documento (PDF, TXT, MD ou DOCX) com a transcrição.',
    unauthorized: 'Este número não está autorizado a solicitar avaliações.\n\n' +
        'Entre em contato com o administrador da sua empresa para verificar o cadastro e a permissão do seu WhatsApp.',
    file_received: 'Arquivo recebido com sucesso.\n\n' +
        'A avaliação foi adicionada à fila de processamento. O resultado será enviado após a conclusão.',
    choose_collaborator: 'Arquivo recebido.\n\n' +
        'Como você é gestor, esta avaliação não será atribuída a você.\n' +
        'Responda com o *número* do colaborador a quem a avaliação pertence:\n\n' +
        '{{lista_colaboradores}}\n\n' +
        'Responda apenas com o número (ex.: 1).',
    invalid_selection: 'Opção inválida.\n\n' +
        'Responda apenas com o número de um colaborador da lista enviada anteriormente.',
    no_collaborators: 'Não há colaboradores vinculados ao seu perfil.\n\n' +
        'Cadastre a equipe no painel Napolean antes de enviar avaliações pelo WhatsApp.',
    processing_error: 'Não foi possível processar seu arquivo agora.\n\n' +
        'Tente novamente em alguns minutos. Se o problema continuar, fale com o administrador.',
};
const ALLOWED_VARS = [
    'nome_usuario',
    'nome_empresa',
    'nome_arquivo',
    'tipo_arquivo',
    'analise_id',
    'lista_colaboradores',
];
/** Substitui {{var}} apenas para as variáveis permitidas (feito no backend). */
export function renderTemplate(content, vars = {}) {
    let out = content;
    for (const key of ALLOWED_VARS) {
        const value = vars[key];
        out = out.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value != null ? String(value) : '');
    }
    return out;
}
//# sourceMappingURL=templates.js.map