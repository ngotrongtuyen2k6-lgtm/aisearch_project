const { getPrompts, setPrompts } = require('../db');

const PROMPT_TYPES = ['image', 'audio', 'document'];

function getAnalysisPrompt(type) {
  return getPrompts()[type];
}

function getAllPrompts() {
  return getPrompts();
}

function updatePrompts(prompts) {
  if (!prompts || PROMPT_TYPES.some(type => typeof prompts[type] !== 'string'
    || prompts[type].trim().length < 20 || prompts[type].length > 20000)) {
    const error = new Error('Cần cung cấp đủ ba prompt, mỗi prompt dài từ 20 đến 20.000 ký tự.');
    error.status = 400;
    throw error;
  }
  setPrompts(Object.fromEntries(PROMPT_TYPES.map(type => [type, prompts[type].trim()])));
  return getAllPrompts();
}

module.exports = { getAnalysisPrompt, getAllPrompts, updatePrompts };
