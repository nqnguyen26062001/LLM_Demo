import BaseRoutes from "./base/BaseRouter";
import ChatController from "../controller/ChatController";

class ChatRoutes extends BaseRoutes {
  public routes(): void {
    this.router.post("", ChatController.postMessage);
  }
}

export default new ChatRoutes().router