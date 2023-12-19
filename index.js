// команды сервера
const server_player_index = "2001";
const server_game_list = "2002";
const server_new_game = "2003";
const server_player_enter = "2004";
const server_player_exit = "2005";
const server_chat_message = "2006";
const server_remove_game = "2007";
const server_message_box = "2999";

// команды клиента
const client_disconnect = "1000";
const client_new_game = "1001";
const client_enter_game = "1002";
const client_exit_game = "1003";
const client_chat_message = "1004";
const client_nothing = "1999";

let net = new require('ws');
let server = new net.Server({port: 3000});
let cur_index = 0;
let connection_list = [];
let games = [];

server.on("connection",(connection) => {
	let received = "";
	connection.client_data_handler =(data) => {
		received += data;
		let index = received.indexOf("\n");
		while(index != -1) {
			let message = received.slice(0, index);
			hostAction(connection, message);
			received = received.replace(message + "\n", "");
			index = received.indexOf("\n");
		}
	}
	connection.client_end_handler =() => {hostAction(connection, JSON.stringify({code: client_disconnect}));}
	connection.on("message", connection.client_data_handler);
	connection.on("close", connection.client_end_handler);
	connection.on("error",() => {});
	connection.index = cur_index ++; // присвоение индекса
	connection_list.push(connection);
	// отправка индекса
	sendMsg(connection, server_player_index, {
		index: connection.index
	});
	// отправка списка игр
	sendMsg(connection, server_game_list, {
		games: makeGameList()
	});
});
server.on("error",(err) => {});

function sendMsg(connection, code, msg) {
	msg.code = code;
	connection.send(`${JSON.stringify(msg)}\n`);
}

function sendToAll(code, msg, game = null) {
	let list = game ? game.connections: connection_list;
	for(let connection of list) sendMsg(connection, code, msg);
}

function findGame(index, in_game = false) {
	return games.find(item => item.index == index && item.in_game == in_game);
}

function findItem(index, arr) {
	return arr.find(item => item.index == index);
}

function deleteItem(index, arr) {
	let i = arr.findIndex(item => item.index == index);
	if (i >= 0) return arr.splice (i, 1);
}

// создание массива для демонстрации вновь подключившемуся списка доступных игр
function makeGameList() {
	let arr = [];
	for(let game of games) {
		let obj = Object.assign({}, game);
		delete obj.connections;
		arr.push(obj);
	}
	return arr;
}

// отключение клиента хостом
function shutDownConnection(connection) {
	// выход из игры
	exitFromGame(connection);
	// удаление из массива подключений
	let index = connection_list.findIndex(item => item.index == connection.index);
	if (index > -1) {
		connection_list.splice(index, 1);
	}
	if (!connection.ended) connection.close(); // завершение соединения
	if (connection_list.length <= 0) cur_index = 0;
}

// выход из игры
function exitFromGame(connection) {
	if (connection.game) {
		sendToAll(server_message_box, {
			message: `Игрок ${connection.player.name} вышел из игры ${connection.game.name}!`
		}, connection.game);
		sendToAll(server_player_exit, {
			game_index: connection.game.index,
			player_index: connection.index,
			in_game: connection.game.in_game
		});
		if (connection.game.index == connection.index && !connection.game.in_game) {
			deleteItem(connection.game.index, games);
			for(let item of connection.game.connections) item.game = null;
		} else {
			deleteItem(connection.index, connection.game.players);
			deleteItem(connection.index, connection.game.connections);
			// игра останавливается, если из неё выходит игрок
			if (connection.game.in_game && connection.player.checked) {
				// если никого не осталось в игре - удалить её
				if (connection.game.players.length <= 0) {
					deleteItem(connection.game.index, games);
				}
			}
			// если из игры выходит её инициатор, ему предоставляется новый индекс,
			// дабы он не мог тревожить уже созданное
			if (connection.game.in_game && connection.index == connection.game.index) {
				connection.index = cur_index++;
				sendMsg(connection, server_player_index, {
					index: connection.index
				});
			}
			connection.game = null;
		}
	}
}

function hostAction(connection, message) {
	console.log(message);
	let msg = null;
	let obj = null;
	let ind = 0;
	try {
		msg = JSON.parse(message);
	} catch(err) {}
	if (!msg) return;
	switch (msg.code) {
		case client_disconnect: // клиент отсоединяется
			shutDownConnection(connection);
			break;
		case client_new_game: // создаётся новая игра
			if (games.find(item => item.name == msg.name && !item.in_game)) {
				sendMsg(connection, server_message_box, {
					message: "Игра с таким названием уже существует!"
				});
				break;
			}
			msg = {
				index: connection.index,
				name: msg.name,
				extension: msg.extension,
				players: [],
				connections: [],
				in_game: false,
				get selected() {return this.players.filter(item => item.checked).length}
			}
			games.push(msg);
			sendToAll(server_new_game, msg);
			sendToAll(server_message_box, {
				message: `$Создана новая игра: ${msg.name}!`
			}, msg);
			break;
		case client_enter_game: // игрок присоединяется к создаваемой партии
			connection.game = findGame(msg.index, false);
			if (!connection.game) break;
			if (connection.game.index == msg.player.index) {
				msg.player.is_host = true;
				msg.player.checked = true;
				msg.player.connected = true;
			}
			connection.player = msg.player;
			connection.game.players.push(connection.player);
			connection.game.connections.push(connection);
			sendToAll(server_player_enter, msg);
			sendToAll(server_message_box, {
				message: `Игрок ${connection.player.name} присоединился к игре ${connection.game.name}!`
			}, connection.game);
			break;
		case client_exit_game: // игрок отсоединяется от создаваемой партии
			exitFromGame(connection);
			break;
		case client_chat_message: // сообщение в чат
			if (!connection.game) break;
			sendToAll(server_chat_message, msg, connection.game);
			break;
	}
}