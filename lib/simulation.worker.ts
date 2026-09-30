import { runSimulation, type SimulationInput } from "./simulation";

self.onmessage = (event: MessageEvent<SimulationInput>) => {
  self.postMessage(runSimulation(event.data));
};
