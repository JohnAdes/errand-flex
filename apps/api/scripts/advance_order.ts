import { markPaymentAuthorizedAndSchedule } from "../src/modules/orders/orders.service";

const orderId = process.argv[2];
markPaymentAuthorizedAndSchedule(orderId).then((o) => {
  console.log("Order advanced to:", o.status);
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
