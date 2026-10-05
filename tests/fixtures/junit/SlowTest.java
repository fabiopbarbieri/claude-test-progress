package fixture;

import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.assertTrue;

@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SlowTest {
    @Test @Order(1) void first() { assertTrue(true); }
    @Test @Order(2) void slow() throws InterruptedException { Thread.sleep(60000); }
}
