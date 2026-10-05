package fixture;

import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

class OutcomesTest {
    @Test void pass() { assertEquals(4, 2 + 2); }
    @Test void failure() { fail("intentional fixture failure"); }
    @Test @Disabled("fixture skip") void skip() { fail("must not execute"); }
    @Test void aborted() { Assumptions.assumeTrue(false, "fixture assumption"); }
    @TestFactory Stream<DynamicTest> dynamic() {
        return Stream.of(1, 2).map(n -> DynamicTest.dynamicTest("dynamic " + n,
            () -> assertTrue(n > 0)));
    }
}
