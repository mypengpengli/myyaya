import { requireNativeModule } from "expo";
export const integrationControl = () => requireNativeModule<{ takeCommand(): string | null; reportResult(value: string): void }>("IntegrationControl");
