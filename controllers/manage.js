"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const AuthHelper = require("../authHelper");
const _ = require("underscore");
const config = require("config");
const serverConfig = config.get('server');
class ManageController {
    constructor(io, ioConnections) {
        this.io = io;
        this.ioConnections = ioConnections;
    }
    static initRoutes() {
        const router = express.Router();
        router.post('/user/active/message', AuthHelper.checkJwt, (req, res) => {
            if (req.headers['admin-code'] !== serverConfig.adminCode) {
                return res.status(401).send('You have not authenticated request as an admin');
            }
            const controller = new ManageController(req.io, req.ioConnections);
            controller.sendMessageToActiveUsers(req.body.message)
                .then((results) => res.send(results))
                .catch((err) => res.status(500).send(err));
        });
        router.get('/user/active', AuthHelper.checkJwt, (req, res) => {
            if (req.headers['admin-code'] !== serverConfig.adminCode) {
                return res.status(401).send('You have not authenticated request as an admin');
            }
            const controller = new ManageController(req.io, req.ioConnections);
            controller.getActiveUsers()
                .then((results) => res.send(results))
                .catch((err) => res.status(500).send(err));
        });
        return router;
    }
    getActiveUsers() {
        return new Promise((resolve) => {
            const connections = _.map(this.ioConnections, (connection) => {
                let name;
                if (connection.practitioner && connection.practitioner.name && connection.practitioner.name.length > 0) {
                    name = connection.practitioner.name[0].family;
                    if (connection.practitioner.name[0].given && connection.practitioner.name[0].given.length > 0) {
                        if (name) {
                            name += ', ';
                        }
                        name += connection.practitioner.name[0].given.join(' ');
                    }
                }
                return {
                    socketId: connection.id,
                    userId: connection.userProfile ? connection.userProfile.user_id : null,
                    email: connection.userProfile ? connection.userProfile.email : null,
                    practitionerReference: connection.practitioner ? `Practitioner/${connection.practitioner.id}` : null,
                    name: name
                };
            });
            resolve(connections);
        });
    }
    sendMessageToActiveUsers(message) {
        return new Promise((resolve) => {
            this.io.emit('message', message);
            resolve();
        });
    }
}
exports.ManageController = ManageController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibWFuYWdlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQW1DO0FBQ25DLDRDQUE0QztBQUU1QyxnQ0FBZ0M7QUFHaEMsaUNBQWlDO0FBRWpDLE1BQU0sWUFBWSxHQUFrQixNQUFNLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBUXpEO0lBSUksWUFBWSxFQUFVLEVBQUUsYUFBZ0M7UUFDcEQsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLENBQUM7UUFDYixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQztJQUN2QyxDQUFDO0lBRU0sTUFBTSxDQUFDLFVBQVU7UUFDcEIsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBRWhDLE1BQU0sQ0FBQyxJQUFJLENBQUMsc0JBQXNCLEVBQW1CLFVBQVUsQ0FBQyxRQUFRLEVBQUUsQ0FBa0IsR0FBa0IsRUFBRSxHQUFHLEVBQUUsRUFBRTtZQUNuSCxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEtBQUssWUFBWSxDQUFDLFNBQVMsRUFBRTtnQkFDdEQsT0FBTyxHQUFHLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxnREFBZ0QsQ0FBQyxDQUFDO2FBQ2pGO1lBRUQsTUFBTSxVQUFVLEdBQUcsSUFBSSxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUNuRSxVQUFVLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUM7aUJBQ2hELElBQUksQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztpQkFDcEMsS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFD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QUUsRUFBRTtZQUMzQixJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDakMsT0FBTyxFQUFFLENBQUM7UUFDZCxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQXpFRCw0Q0F5RUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBleHByZXNzIGZyb20gJ2V4cHJlc3MnO1xuaW1wb3J0ICogYXMgQXV0aEhlbHBlciBmcm9tICcuLi9hdXRoSGVscGVyJztcbmltcG9ydCB7Q29ubmVjdGlvbk1vZGVsLCBFeHRlbmRlZFJlcXVlc3QsIElPQ29ubmVjdGlvbiwgU2VydmVyQ29uZmlnfSBmcm9tICcuL21vZGVscyc7XG5pbXBvcnQgKiBhcyBfIGZyb20gJ3VuZGVyc2NvcmUnO1xuaW1wb3J0IHtTZXJ2ZXJ9IGZyb20gJ3NvY2tldC5pbyc7XG5pbXBvcnQge1JlcXVlc3RIYW5kbGVyfSBmcm9tICdleHByZXNzJztcbmltcG9ydCAqIGFzIGNvbmZpZyBmcm9tICdjb25maWcnO1xuXG5jb25zdCBzZXJ2ZXJDb25maWcgPSA8U2VydmVyQ29uZmlnPiBjb25maWcuZ2V0KCdzZXJ2ZXInKTtcblxuaW50ZXJmYWNlIE1hbmFnZVJlcXVlc3QgZXh0ZW5kcyBFeHRlbmRlZFJlcXVlc3Qge1xuICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ2FkbWluLWNvZGUnOiBzdHJpbmdcbiAgICB9O1xufVxuXG5leHBvcnQgY2xhc3MgTWFuYWdlQ29udHJvbGxlciB7XG4gICAgcHJpdmF0ZSBpbzogU2VydmVyO1xuICAgIHByaXZhdGUgaW9Db25uZWN0aW9uczogQ29ubmVjdGlvbk1vZGVsW107XG5cbiAgICBjb25zdHJ1Y3RvcihpbzogU2VydmVyLCBpb0Nvbm5lY3Rpb25zOiBDb25uZWN0aW9uTW9kZWxbXSkge1xuICAgICAgICB0aGlzLmlvID0gaW87XG4gICAgICAgIHRoaXMuaW9Db25uZWN0aW9ucyA9IGlvQ29ubmVjdGlvbnM7XG4gICAgfVxuXG4gICAgcHVibGljIHN0YXRpYyBpbml0Um91dGVzKCkge1xuICAgICAgICBjb25zdCByb3V0ZXIgPSBleHByZXNzLlJvdXRlcigpO1xuXG4gICAgICAgIHJvdXRlci5wb3N0KCcvdXNlci9hY3RpdmUvbWVzc2FnZScsIDxSZXF1ZXN0SGFuZGxlcj4gQXV0aEhlbHBlci5jaGVja0p3dCwgPFJlcXVlc3RIYW5kbGVyPiAocmVxOiBNYW5hZ2VSZXF1ZXN0LCByZXMpID0+IHtcbiAgICAgICAgICAgIGlmIChyZXEuaGVhZGVyc1snYWRtaW4tY29kZSddICE9PSBzZXJ2ZXJDb25maWcuYWRtaW5Db2RlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5zZW5kKCdZb3UgaGF2ZSBub3QgYXV0aGVudGljYXRlZCByZXF1ZXN0IGFzIGFuIGFkbWluJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgTWFuYWdlQ29udHJvbGxlcihyZXEuaW8sIHJlcS5pb0Nvbm5lY3Rpb25zKTtcbiAgICAgICAgICAgIGNvbnRyb2xsZXIuc2VuZE1lc3NhZ2VUb0FjdGl2ZVVzZXJzKHJlcS5ib2R5Lm1lc3NhZ2UpXG4gICAgICAgICAgICAgICAgLnRoZW4oKHJlc3VsdHMpID0+IHJlcy5zZW5kKHJlc3VsdHMpKVxuICAgICAgICAgICAgICAgIC5jYXRjaCgoZXJyKSA9PiByZXMuc3RhdHVzKDUwMCkuc2VuZChlcnIpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcm91dGVyLmdldCgnL3VzZXIvYWN0aXZlJywgPFJlcXVlc3RIYW5kbGVyPiBBdXRoSGVscGVyLmNoZWNrSnd0LCA8UmVxdWVzdEhhbmRsZXI+IChyZXE6IE1hbmFnZVJlcXVlc3QsIHJlcykgPT4ge1xuICAgICAgICAgICAgaWYgKHJlcS5oZWFkZXJzWydhZG1pbi1jb2RlJ10gIT09IHNlcnZlckNvbmZpZy5hZG1pbkNvZGUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLnNlbmQoJ1lvdSBoYXZlIG5vdCBhdXRoZW50aWNhdGVkIHJlcXVlc3QgYXMgYW4gYWRtaW4nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBNYW5hZ2VDb250cm9sbGVyKHJlcS5pbywgcmVxLmlvQ29ubmVjdGlvbnMpO1xuICAgICAgICAgICAgY29udHJvbGxlci5nZXRBY3RpdmVVc2VycygpXG4gICAgICAgICAgICAgICAgLnRoZW4oKHJlc3VsdHMpID0+IHJlcy5zZW5kKHJlc3VsdHMpKVxuICAgICAgICAgICAgICAgIC5jYXRjaCgoZXJyKSA9PiByZXMuc3RhdHVzKDUwMCkuc2VuZChlcnIpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJvdXRlcjtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0QWN0aXZlVXNlcnMoKTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjb25uZWN0aW9ucyA9IF8ubWFwKHRoaXMuaW9Db25uZWN0aW9ucywgKGNvbm5lY3Rpb246IElPQ29ubmVjdGlvbikgPT4ge1xuICAgICAgICAgICAgICAgIGxldCBuYW1lO1xuXG4gICAgICAgICAgICAgICAgaWYgKGNvbm5lY3Rpb24ucHJhY3RpdGlvbmVyICYmIGNvbm5lY3Rpb24ucHJhY3RpdGlvbmVyLm5hbWUgJiYgY29ubmVjdGlvbi5wcmFjdGl0aW9uZXIubmFtZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWUgPSBjb25uZWN0aW9uLnByYWN0aXRpb25lci5uYW1lWzBdLmZhbWlseTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoY29ubmVjdGlvbi5wcmFjdGl0aW9uZXIubmFtZVswXS5naXZlbiAmJiBjb25uZWN0aW9uLnByYWN0aXRpb25lci5uYW1lWzBdLmdpdmVuLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChuYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZSArPSAnLCAnO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lICs9IGNvbm5lY3Rpb24ucHJhY3RpdGlvbmVyLm5hbWVbMF0uZ2l2ZW4uam9pbignICcpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgc29ja2V0SWQ6IGNvbm5lY3Rpb24uaWQsXG4gICAgICAgICAgICAgICAgICAgIHVzZXJJZDogY29ubmVjdGlvbi51c2VyUHJvZmlsZSA/IGNvbm5lY3Rpb24udXNlclByb2ZpbGUudXNlcl9pZCA6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGVtYWlsOiBjb25uZWN0aW9uLnVzZXJQcm9maWxlID8gY29ubmVjdGlvbi51c2VyUHJvZmlsZS5lbWFpbCA6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIHByYWN0aXRpb25lclJlZmVyZW5jZTogY29ubmVjdGlvbi5wcmFjdGl0aW9uZXIgPyBgUHJhY3RpdGlvbmVyLyR7Y29ubmVjdGlvbi5wcmFjdGl0aW9uZXIuaWR9YCA6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWVcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJlc29sdmUoY29ubmVjdGlvbnMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2VuZE1lc3NhZ2VUb0FjdGl2ZVVzZXJzKG1lc3NhZ2U6IHN0cmluZyk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5pby5lbWl0KCdtZXNzYWdlJywgbWVzc2FnZSk7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH0pO1xuICAgIH1cbn0iXX0=