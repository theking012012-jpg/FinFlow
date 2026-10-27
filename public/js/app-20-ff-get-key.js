// Moved out of index.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
// No-op stubs so any legacy call-sites don't throw
window.ffGetKey      = function(){ return true; };
window.ffSetKey      = function(){};
window.ffClearKey    = function(){};
window.ffShowKeyModal= function(){};
window.ffKeyPromptHTML = function(){ return ''; };
