
// No-op stubs so any legacy call-sites don't throw
window.ffGetKey      = function(){ return true; };
window.ffSetKey      = function(){};
window.ffClearKey    = function(){};
window.ffShowKeyModal= function(){};
window.ffKeyPromptHTML = function(){ return ''; };
