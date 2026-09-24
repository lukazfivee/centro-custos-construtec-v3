// Fora do app (navegador com o mock), carrega a ponte de desenvolvimento. No APK a ponte nativa ja existe.
if (!window.AndroidAuth) document.write('<script src="dev-bridge.js"><\/script>');
