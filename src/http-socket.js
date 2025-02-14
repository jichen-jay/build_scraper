const server = net.createServer(async (socket) => {
    socket.on('data', async (chunk) => {
        const data = chunk.toString();
        const urlMatch = data.match(/GET \/scrape\/([^\s]+) HTTP/); // Modified regex to match HTTP GET request

        const headers = [
            'HTTP/1.1 200 OK',
            'Content-Type: application/json',
            'Content-Length: ${length}',
            'Connection: close',
            '',
            ''  // Double empty line is important
        ].join('\r\n');

        if (urlMatch) {
            try {
                const url = decodeURIComponent(urlMatch[1]);
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    throw new Error('URL must start with http:// or https://');
                }

                const content = await openOneTab(url);
                const response = JSON.stringify({
                    status: 'success',
                    content
                });

                socket.write(headers.replace('${length}', Buffer.byteLength(response)) + response);
            } catch (error) {
                const errorResponse = JSON.stringify({
                    status: 'error',
                    error: error.message
                });
                socket.write(headers.replace('${length}', Buffer.byteLength(errorResponse)) + errorResponse);
            }
        } else {
            const errorResponse = JSON.stringify({
                status: 'error',
                error: 'Invalid request format. Use /scrape/https://example.com'
            });
            socket.write(headers.replace('${length}', Buffer.byteLength(errorResponse)) + errorResponse);
        }
        socket.end();
    });
});


(async () => {
    await initializeBrowser();
    const PORT = 3000;
    server.listen(PORT, () => {
        console.log(`Scraper service listening on port ${PORT}`);
    });
})();
