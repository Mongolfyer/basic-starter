// команды сервера
const server_client_accepted = "2001";
const server_player_index = "2002";
const server_game_list = "2003";
const server_new_game = "2004";
const server_player_enter = "2005";
const server_player_exit = "2006";
const server_player_change = "2007";
const server_action_message = "2008";
const server_remove_game = "2009";
const server_start_game = "2010";
const server_chat_message = "2011";
const server_message_box = "2999";

// команды клиента
const client_disconnect = "1000";
const client_player_index = "1001";
const client_new_game = "1002";
const client_enter_game = "1003";
const client_exit_game = "1004";
const client_change = "1005";
const client_action_message = "1006";
const client_start_game = "1007";
const client_chat_message = "1008";
const client_echo = "1997";
const client_reconnect = "1998";
const client_nothing = "1999";

let net = new require('ws');
let server = new net.Server({port: 3000});
let cur_index = 0;
let connection_list = {};
let games = {};

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
	connection.passcode = randomInt(999999);
	connection.actions_seq = [];
	connection.seq_index = 0;
	sendMsg(connection, server_client_accepted, {});
});
server.on("error",(err) => {});

// генератор случайных чисел
function randomInt(max_value) {
	return Math.floor(Math.random() * Math.floor(max_value + 1));
}

function sendMsg(connection, code, msg) {
	connection.seq_index++;
	msg.seq_index = connection.seq_index;
	connection.actions_seq.push({
		index: msg.seq_index,
		code: code,
		msg: msg
	});
	msg.code = code;
	connection.send(`${JSON.stringify(msg)}\n`);
}

function sendToAll(code, msg, prog, game = null) {
	let list = game ? game.connections : connection_list[prog];
	for(let connection of list) sendMsg(connection, code, msg);
}

function findGame(index, prog, in_game = false) {
	return games[prog].find(item => item.index == index && item.in_game == in_game);
}

function findItem(index, arr) {
	return arr.find(item => item.index == index);
}

function deleteItem(index, arr) {
	let i = arr.findIndex(item => item.index == index);
	if (i >= 0) return arr.splice (i, 1);
}

// создание массива для демонстрации вновь подключившемуся списка доступных игр
function makeGameList(prog) {
	let arr = [];
	for(let game of games[prog]) {
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
	if (!connection_list[connection.prog]) return;
	let index = connection_list[connection.prog].findIndex(item => item.index == connection.index);
	if (index > -1) {
		connection_list[connection.prog].splice(index, 1);
	}
	if (!connection.ended) connection.close(); // завершение соединения
	if (connection_list[connection.prog].length <= 0) cur_index = 0;
}

// выход из игры
function exitFromGame(connection) {
	if (connection.game) {
		sendToAll(server_player_exit, {
			game_index: connection.game.index,
			player_index: connection.index,
			in_game: connection.game.in_game
		}, connection.prog);
		if (connection.game.index == connection.index && !connection.game.in_game) {
			deleteItem(connection.game.index, games[connection.prog]);
			for(let item of connection.game.connections) item.game = null;
		} else {
			deleteItem(connection.index, connection.game.players);
			deleteItem(connection.index, connection.game.connections);
			// игра останавливается, если из неё выходит игрок
			if (connection.game.in_game && connection.player.checked) {
				// если никого не осталось в игре - удалить её
				if (connection.game.players.length <= 0) {
					deleteItem(connection.game.index, games[connection.prog]);
				}
			}
			// выходящим из игры игрокам назначаются новые индексы
			if (connection.game.in_game) {
				connection.index = cur_index++;
				sendMsg(connection, server_player_index, {
					index: connection.index,
					passcode: connection.passcode
				});
			}
			connection.game = null;
		}
	}
}

function playGo(game, prog) {
	if (!game) return;
	game.in_game = true;
	// очистка списка от несостоявшихся игроков
	for (let connection of game.connections) {
		if (!connection.player.checked) {
			// выражается сожаление
			if (game.index != connection.index) {
				sendMsg(connection, server_message_box, {
					message: "К сожалению, игра была начата без Вас! Попробуйте присоединиться к<br>другой партии или создайте свою!"
				});
			}
			exitFromGame(connection);
		}
	}
	game.players = game.players.filter (item => item.checked);
	game.connections = game.connections.filter (item => item.player.checked);
	// удаление игры из списка доступных для присоединения
	deleteItem (game.index, games[prog]);
	sendToAll (server_remove_game, {game_index : game.index}, prog);
	// сообщение игрокам, что они теперь играют
	sendToAll (server_start_game, {
		players: game.players
	}, prog, game);
}

function hostAction(connection, message) {
	//console.log(message);
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
		case client_player_index: // клиент запрашивает индекс игрока
			if (!msg.prog) break;
			connection.index = cur_index ++; // присвоение индекса
			connection.prog = msg.prog;
			if (!connection_list[msg.prog]) connection_list[msg.prog] = [];
			connection_list[connection.prog].push(connection);
			if (!games[msg.prog]) games[msg.prog] = [];
			// отправка индекса
			sendMsg(connection, server_player_index, {
				index: connection.index,
				passcode: connection.passcode
			});
			// отправка списка игр
			sendMsg(connection, server_game_list, {
				games: makeGameList(connection.prog)
			});
			break;
		case client_new_game: // создаётся новая игра
			if (!games[connection.prog]) break;
			if (games[connection.prog].find(item => item.name == msg.name && !item.in_game)) {
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
			if (!games[connection.prog]) break;
			games[connection.prog].push(msg);
			sendToAll(server_new_game, msg, connection.prog);
			break;
		case client_enter_game: // игрок присоединяется к создаваемой партии
			connection.game = findGame(msg.index, connection.prog, false);
			if (!connection.game) break;
			if (connection.game.index == msg.player.index) {
				msg.player.is_host = true;
				msg.player.checked = true;
			}
			msg.player.connected = true;
			connection.player = msg.player;
			connection.game.players.push(connection.player);
			connection.game.connections.push(connection);
			sendToAll(server_player_enter, msg, connection.prog);
			break;
		case client_exit_game: // игрок отсоединяется от создаваемой партии
			exitFromGame(connection);
			break;
		case client_change: // изменение параметров игрока
			if (!connection.game) break;
			obj = findItem (msg.player.index, connection.game.players);
			if (!obj) break;
			for (let item in msg.player) obj[item] = msg.player[item];
			msg.game_index = connection.game.index;
			sendToAll (server_player_change, msg, connection.prog);
			break;
		case client_action_message: // общение между клиентами
			if (!connection.game) break;
			msg.player = {index: connection.index}
			if (msg.index >= 0) {
				let con = findItem(msg.index, connection_list[connection.prog]);
				if (con) sendMsg(con, server_action_message, msg);
			} else {
				sendToAll(server_action_message, msg, connection.prog, connection.game);
			}
			break;
		case client_start_game: // старт игры
			playGo(connection.game, connection.prog);
			break;
		case client_chat_message: // сообщение в чат
			sendToAll(server_chat_message, msg, connection.prog, connection.game);
			break;
		case client_echo: // клиент отвечает эхом
			ind = connection.actions_seq.findIndex(item => item.index == msg.index);
			if (ind > -1) connection.actions_seq.splice(ind, 1);
			break;
		case client_reconnect: // игрок переподключается после обрыва связи
			if (msg.player_index == connection.index || !connection_list[connection.prog]) {
				sendMsg(connection, server_player_index, {
					index: connection.index,
					passcode: connection.passcode
				});
				break;
			}
			ind = connection_list[connection.prog].findIndex(item => item.index == msg.player_index);
			if (ind > -1 && connection_list[connection.prog][ind].passcode == msg.passcode) {
				let new_ind = connection_list[connection.prog].findIndex(item => item.index == connection.index);
				obj = connection_list[connection.prog][ind];
				let actions_seq = obj.actions_seq;
				connection.index = obj.index; // присвоение индекса
				connection.game = obj.game;
				connection.player = obj.player; // ассоциация с игроком
				if (connection.game) {
					let i = obj.game.connections.findIndex(item => item.index == obj.index);
					if (i > -1) obj.game.connections[i] = connection;
				}
				connection_list[connection.prog][ind] = connection;
				if (new_ind > -1) connection_list[connection.prog].splice(new_ind, 1);
				sendMsg(connection, server_player_index, {
					index: connection.index,
					passcode: connection.passcode
				});
				for (let action of actions_seq) sendMsg(connection, action.code, action.msg);
			}
			break;
	}
}