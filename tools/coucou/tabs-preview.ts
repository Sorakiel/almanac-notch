import "../src/style.css";
import { Island } from "../src/island/island";
import { State } from "../src/core/state";
const island = new Island(document.getElementById("root") as HTMLElement);
Object.assign(window, { island, State });
